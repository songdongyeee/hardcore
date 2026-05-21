import type { AITutorService, TutorMessage, SessionContext, ChatResult, StateUpdate } from './index';
import { pb, silentLogin } from '@/lib/api';
import { Preferences } from '@capacitor/preferences';

/**
 * Aliyun full-stack implementation.
 * ASR  → Paraformer-Realtime (via PocketBase hook)
 * LLM  → Qwen-Plus          (via PocketBase hook)
 * TTS  → CosyVoice 2.0      (via PocketBase hook, supports zh/en code-switching)
 */
export class AliyunTutorService implements AITutorService {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  getOpeningMessage(context: SessionContext): string {
    if (context.markedWords.length === 0) {
      return '你好，我是 Nex！我发现你还没有标记生词。先去文章里把你不熟悉的词标记一下，我才能帮你针对性地练习和记忆。';
    }
    const wordList = context.markedWords.map(w => `「${w.text}」`).join('、');
    const firstWord = context.markedWords[0].text;
    return `你好，我是 Nex！我看到你标记了 ${context.markedWords.length} 个词：${wordList}。我们来练练吧——在原文里，「${firstWord}」是什么意思？你还记得吗？`;
  }

  private get authHeader(): Record<string, string> {
    const token = pb.authStore.token;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  async transcribeAudio(audioBlob: Blob, mimeType: string): Promise<string> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const audioBase64 = btoa(binary);

    const res = await fetch(`${this.baseUrl}/api/mnemonic/asr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader },
      body: JSON.stringify({ audioBase64, mimeType }),
    });
    const data = await res.json();
    return data.text ?? '';
  }

  /** Strip markdown formatting so TTS reads clean natural speech */
  private cleanForSpeech(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`(.+?)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async tryReAuth(): Promise<void> {
    const isValid = pb.authStore.isValid;
    const hasToken = !!pb.authStore.token;
    console.log(`[AITutor] 🔐 tryReAuth — isValid=${isValid}, hasToken=${hasToken}`);

    if (isValid) {
      try {
        await pb.collection('users').authRefresh();
        console.log('[AITutor] 🔐 authRefresh OK, new token:', pb.authStore.token?.slice(0, 20) + '…');
        return;
      } catch (e) {
        console.warn('[AITutor] 🔐 authRefresh failed:', String(e));
      }
    }

    // Fall back to silentLogin with cached RevenueCat ID
    try {
      const { value: cachedId } = await Preferences.get({ key: 'last_rc_id' });
      console.log('[AITutor] 🔐 silentLogin attempt, cachedId:', cachedId ? cachedId.slice(0, 12) + '…' : 'null');
      if (cachedId) {
        await silentLogin(cachedId);
        console.log('[AITutor] 🔐 silentLogin OK, token:', pb.authStore.token?.slice(0, 20) + '…');
      } else {
        console.warn('[AITutor] 🔐 no cachedId in Preferences — cannot re-authenticate');
      }
    } catch (e) {
      console.error('[AITutor] 🔐 silentLogin failed:', String(e));
    }
  }

  async chat(messages: TutorMessage[], context: SessionContext): Promise<ChatResult> {
    // ─── Architecture: PB Collection event hook ─────────────────────────────
    // We create a record in `nex_chat_requests`. PB validates auth via the
    // collection's Create Rule (`@request.auth.id != ""`). The server-side
    // `onRecordAfterCreateRequest` hook synchronously runs the LLM and writes
    // `reply`/`state_update`/`status` back to the same record before this
    // create() call returns.

    const userId = pb.authStore.model?.id;
    if (!userId) {
      // No authStore.model → not logged in. Try one re-auth pass, then bail.
      await this.tryReAuth();
      if (!pb.authStore.model?.id) {
        throw new Error('UNAUTHORIZED');
      }
    }

    const payload = {
      user_id: pb.authStore.model!.id,
      messages,
      marked_words: context.markedWords.map(w => ({
        text: w.text,
        sentence: context.transcript[w.segmentIndex]?.text ?? '',
      })),
      material_title: context.materialTitle,
      conversation_state: context.conversationState ?? null,
      status: 'pending' as const,
    };

    const makeRequest = () =>
      pb.collection('nex_chat_requests').create<{
        id: string;
        status: 'pending' | 'processing' | 'done' | 'error';
        reply: string;
        state_update: StateUpdate;
        error_msg: string;
      }>(payload);

    console.log('[AITutor] 💬 chat — creating record, token isValid:', pb.authStore.isValid);
    let record;
    try {
      record = await makeRequest();
    } catch (err: any) {
      // PB SDK throws ClientResponseError with .status / .response
      const status = err?.status ?? 0;
      console.log('[AITutor] 💬 chat first response status:', status, 'msg:', err?.message);
      if (status === 401 || status === 403) {
        await this.tryReAuth();
        try {
          record = await makeRequest();
          console.log('[AITutor] 💬 chat retry status: ok');
        } catch (retryErr: any) {
          console.log('[AITutor] 💬 chat retry status:', retryErr?.status, 'msg:', retryErr?.message);
          throw new Error('UNAUTHORIZED');
        }
      } else {
        throw new Error(`chat_request_failed: ${err?.message || status}`);
      }
    }

    console.log('[AITutor] 💬 chat record returned, status:', record.status, 'replyLen:', (record.reply || '').length);

    // Hook ran synchronously — record should be in final state now.
    if (record.status === 'error') {
      const msg = record.error_msg || '';
      if (msg.startsWith('daily_limit_exceeded'))   throw new Error('DAILY_LIMIT');
      if (msg.startsWith('monthly_limit_exceeded')) throw new Error('MONTHLY_LIMIT');
      throw new Error(`chat_error: ${msg}`);
    }
    if (record.status !== 'done') {
      // Shouldn't happen with synchronous hook, but be defensive
      throw new Error(`chat_unexpected_status: ${record.status}`);
    }

    const reply = this.cleanForSpeech(record.reply ?? '');
    const stateUpdate: StateUpdate = record.state_update ?? { advancement: false };
    return { reply, stateUpdate };
  }

  private currentAudio: HTMLAudioElement | null = null;

  async speak(text: string, onStart?: () => void, onEnd?: () => void): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/mnemonic/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`TTS API ${res.status}: ${JSON.stringify(errData)}`);
      }

      const data = await res.json();
      if (!data.audioUrl) throw new Error('no audioUrl in response');

      onStart?.();
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(data.audioUrl);
        this.currentAudio = audio;
        audio.onended = () => { this.currentAudio = null; resolve(); };
        audio.onerror = () => { this.currentAudio = null; reject(new Error(`Audio load failed: ${data.audioUrl}`)); };
        audio.play().catch(reject);
      });
    } catch (err) {
      console.error('[TTS] failed, falling back to browser TTS:', err);
      onStart?.();
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = /[一-鿿]/.test(text) ? 'zh-CN' : 'en-US';
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    }
    onEnd?.();
  }

  stopSpeaking(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    window.speechSynthesis.cancel();
  }
}
