import type { AITutorService, TutorMessage, SessionContext } from './index';
import { pb } from '@/lib/api';

/**
 * Aliyun full-stack implementation.
 * ASR  → Paraformer-Realtime (via PocketBase hook)
 * LLM  → Qwen-Plus          (via PocketBase hook)
 * TTS  → CosyVoice 2.0      (via PocketBase hook, supports zh/en code-switching)
 *
 * TODO: implement when Aliyun API keys are configured in PocketBase env.
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

  async chat(messages: TutorMessage[], context: SessionContext): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/mnemonic/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader },
      body: JSON.stringify({
        messages,
        markedWords: context.markedWords.map(w => ({
          text: w.text,
          sentence: (w as any).sentence ?? '',
        })),
        materialTitle: context.materialTitle,
      }),
    });

    if (res.status === 429) {
      const data = await res.json();
      throw new Error(data.error === 'daily_limit_exceeded' ? 'DAILY_LIMIT' : 'MONTHLY_LIMIT');
    }
    if (res.status === 401) throw new Error('UNAUTHORIZED');

    const data = await res.json();
    return data.reply ?? '';
  }

  private currentAudio: HTMLAudioElement | null = null;

  async speak(text: string, onStart?: () => void, onEnd?: () => void): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/mnemonic/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.audioUrl) throw new Error('no audioUrl');

      onStart?.();
      await new Promise<void>((resolve) => {
        const audio = new Audio(data.audioUrl);
        this.currentAudio = audio;
        audio.onended = () => { this.currentAudio = null; resolve(); };
        audio.onerror = () => { this.currentAudio = null; resolve(); };
        audio.play().catch(() => resolve());
      });
    } catch (err) {
      console.error('[TTS] failed, falling back to browser TTS:', err);
      // Fallback to browser TTS
      onStart?.();
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = /[一-龥]/.test(text) ? 'zh-CN' : 'en-US';
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
