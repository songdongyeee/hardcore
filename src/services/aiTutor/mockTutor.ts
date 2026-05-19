import type { AITutorService, TutorMessage, SessionContext } from './index';
import { pb } from '@/lib/pocketbase';

const AI_TURNS: string[] = [
  "Good try! Now, can you tell me how you would use this word in a sentence of your own? Take your time.",
  "Nice! Do you remember where exactly this word appeared in the article? What was happening in that scene?",
  "Great, let's move on. What about the next word you marked — what do you think it means?",
  "You're doing well. Try to explain it as if you're teaching someone who has never heard this word before.",
  "Excellent session! You've clearly internalized these words. Keep reviewing them in context and you'll never forget them.",
];

// Detect if we're running inside Capacitor (device/simulator) vs browser dev
const BASE_URL = pb.baseUrl ?? '';

async function cosyVoiceSpeak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/mnemonic/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return false;

    const { audioUrl } = await res.json() as { audioUrl?: string };
    if (!audioUrl) return false;

    onStart?.();
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(audioUrl);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('audio error'));
      audio.play().catch(reject);
    });
    onEnd?.();
    return true;
  } catch {
    return false;
  }
}

/** Pick the most natural-sounding browser voice available on this device */
function pickBestVoice(lang: 'zh-CN' | 'en-US'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const candidates = voices.filter(v => v.lang.startsWith(lang.split('-')[0]));
  // Prefer Apple Enhanced / Premium voices (named with "Enhanced" or "Premium")
  return (
    candidates.find(v => v.name.includes('Enhanced') || v.name.includes('Premium')) ??
    candidates.find(v => v.localService) ??
    candidates[0] ??
    null
  );
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export class MockTutorService implements AITutorService {
  getOpeningMessage(context: SessionContext): string {
    const wordList = context.markedWords.map(w => `"${w.text}"`).join('、');
    const firstWord = context.markedWords[0]?.text ?? 'the first word';
    return `我看到你在这篇文章里标记了 ${context.markedWords.length} 个词：${wordList}。\n\n我们来练习一下——请用英语告诉我，"${firstWord}" 是什么意思？怎么理解它？`;
  }

  async transcribeAudio(_blob: Blob, _mimeType: string): Promise<string> {
    await new Promise(r => setTimeout(r, 700));
    return '[语音输入已识别]';
  }

  async chat(messages: TutorMessage[], _context: SessionContext): Promise<string> {
    await new Promise(r => setTimeout(r, 900));
    const userTurns = messages.filter(m => m.role === 'user').length;
    return AI_TURNS[Math.min(userTurns - 1, AI_TURNS.length - 1)];
  }

  async speak(text: string, onStart?: () => void, onEnd?: () => void): Promise<void> {
    // 1. Try Aliyun CosyVoice (natural, recommended)
    const ok = await cosyVoiceSpeak(text, onStart, onEnd);
    if (ok) return;

    // 2. Fallback: browser SpeechSynthesis with best available voice
    window.speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      // Wait for voices to load if needed
      const doSpeak = () => {
        const isChinese = /[一-龥]/.test(text);
        const lang = isChinese ? 'zh-CN' : 'en-US';
        const voice = pickBestVoice(lang);

        currentUtterance = new SpeechSynthesisUtterance(text);
        currentUtterance.lang = lang;
        currentUtterance.rate = 0.88;
        currentUtterance.pitch = 1.05;
        if (voice) currentUtterance.voice = voice;

        currentUtterance.onstart = () => onStart?.();
        currentUtterance.onend = () => { onEnd?.(); resolve(); };
        currentUtterance.onerror = () => { onEnd?.(); resolve(); };

        onStart?.();
        window.speechSynthesis.speak(currentUtterance);
      };

      if (window.speechSynthesis.getVoices().length > 0) {
        doSpeak();
      } else {
        window.speechSynthesis.onvoiceschanged = () => { doSpeak(); };
      }
    });
  }

  stopSpeaking(): void {
    window.speechSynthesis.cancel();
    currentUtterance = null;
  }
}
