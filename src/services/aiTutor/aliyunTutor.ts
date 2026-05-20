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
    try {
      // Try token refresh first (fast path)
      if (pb.authStore.isValid) {
        await pb.collection('users').authRefresh();
        return;
      }
    } catch {}
    // Fall back to silentLogin with cached RevenueCat ID
    try {
      const { value: cachedId } = await Preferences.get({ key: 'last_rc_id' });
      if (cachedId) await silentLogin(cachedId);
    } catch {}
  }

  async chat(messages: TutorMessage[], context: SessionContext): Promise<ChatResult> {
    const makeRequest = () => fetch(`${this.baseUrl}/api/mnemonic/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader },
      body: JSON.stringify({
        messages,
        markedWords: context.markedWords.map(w => ({
          text: w.text,
          sentence: context.transcript[w.segmentIndex]?.text ?? '',
        })),
        materialTitle: context.materialTitle,
        conversationState: context.conversationState ?? null,
      }),
    });

    let res = await makeRequest();

    // On 401, re-authenticate once and retry
    if (res.status === 401) {
      await this.tryReAuth();
      res = await makeRequest();
    }

    if (res.status === 429) {
      const data = await res.json();
      throw new Error(data.error === 'daily_limit_exceeded' ? 'DAILY_LIMIT' : 'MONTHLY_LIMIT');
    }
    if (res.status === 401) throw new Error('UNAUTHORIZED');

    const data = await res.json();
    const reply = this.cleanForSpeech(data.reply ?? '');

    // Backend returns stateUpdate signals; fall back to no-op if absent
    const stateUpdate: StateUpdate = data.stateUpdate ?? { advancement: false };

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
