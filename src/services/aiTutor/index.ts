import type { MarkedWord } from '@/App';
import type { TranscriptSegment } from '@/data/transcript';

export type OrbState = 'connecting' | 'idle' | 'listening' | 'active' | 'thinking' | 'speaking' | 'muted' | 'paused';

export type WordStatus = 'unseen' | 'mastered' | 'failed';

export interface ConversationState {
  currentWordIndex: number;
  wordStatus: Record<string, WordStatus>;
  attemptCount: number;
  sessionPhase: 'drilling' | 'wrapping';
}

export interface StateUpdate {
  advancement: boolean;
  wordResult?: WordStatus;
  sessionPhase?: 'drilling' | 'wrapping';
}

export interface ChatResult {
  reply: string;
  stateUpdate: StateUpdate;
}

export interface TutorMessage {
  id: string;
  role: 'ai' | 'user';
  text: string;
}

export interface SessionContext {
  markedWords: MarkedWord[];
  transcript: TranscriptSegment[];
  materialTitle?: string;
  conversationState?: ConversationState;
}

/**
 * Abstract interface for the AI tutor backend.
 * Swap implementations to switch between Mock / Aliyun / OpenAI Realtime.
 */
export interface AITutorService {
  /** First message the AI sends when the session opens */
  getOpeningMessage(context: SessionContext): string;

  /** Speech-to-text: audio blob → transcript string */
  transcribeAudio(audioBlob: Blob, mimeType: string): Promise<string>;

  /** Send conversation history, get next AI reply */
  chat(messages: TutorMessage[], context: SessionContext): Promise<ChatResult>;

  /**
   * Text-to-speech. Calls onStart when audio begins, onEnd when finished.
   * Implementations may use browser SpeechSynthesis, Aliyun CosyVoice, etc.
   */
  speak(text: string, onStart?: () => void, onEnd?: () => void): Promise<void>;

  /** Immediately cancel any in-progress TTS playback */
  stopSpeaking(): void;
}
