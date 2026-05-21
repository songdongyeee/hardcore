import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  OrbState, TutorMessage, SessionContext,
  ConversationState, StateUpdate, WordStatus,
} from '@/services/aiTutor/index';
import type { MarkedWord } from '@/App';
import { AliyunTutorService } from '@/services/aiTutor/aliyunTutor';

// ── Conversation-state helpers ────────────────────────────────────────────────

function buildInitialConvState(markedWords: MarkedWord[]): ConversationState {
  return {
    currentWordIndex: 0,
    wordStatus: Object.fromEntries(markedWords.map(w => [w.text, 'unseen' as WordStatus])),
    attemptCount: 0,
    sessionPhase: 'drilling',
  };
}

function applyStateUpdate(
  current: ConversationState,
  update: StateUpdate,
  markedWords: MarkedWord[],
): ConversationState {
  const currentWordText = markedWords[current.currentWordIndex]?.text;
  const newWordStatus = { ...current.wordStatus };

  if (currentWordText && update.wordResult) {
    newWordStatus[currentWordText] = update.wordResult;
  }

  let newIndex = current.currentWordIndex;
  let newAttemptCount = current.attemptCount;

  if (update.advancement) {
    if (currentWordText && !update.wordResult) {
      newWordStatus[currentWordText] = 'mastered';
    }
    newIndex = Math.min(current.currentWordIndex + 1, markedWords.length - 1);
    newAttemptCount = 0;
  }

  return {
    currentWordIndex: newIndex,
    wordStatus: newWordStatus,
    attemptCount: newAttemptCount,
    sessionPhase: update.sessionPhase ?? current.sessionPhase,
  };
}

const tutor = new AliyunTutorService('https://zjcnex.top');

export type InputMode = 'voice' | 'text';

// VAD thresholds (normalised 0–1)
const VAD_VOICE_THRESHOLD = 0.12;   // amplitude above this = speaking
const VAD_SILENCE_THRESHOLD = 0.06; // amplitude below this = silence
const VAD_SILENCE_DURATION = 1500;  // ms of silence before we stop recording

export function useAITutor(context: SessionContext | null) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [baseState, setBaseState] = useState<OrbState>('connecting');
  const [override, setOverride] = useState<null | 'muted' | 'paused'>(null);
  const [aiSubtitle, setAiSubtitle] = useState('');
  const [transcriptLive, setTranscriptLive] = useState('');
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  const [textInput, setTextInput] = useState('');
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [lastAIQuestion, setLastAIQuestion] = useState('');

  // Authoritative conversation state — drives word index, attempt count, phase
  const [convState, setConvState] = useState<ConversationState>(() =>
    buildInitialConvState(context?.markedWords ?? [])
  );
  const convStateRef = useRef<ConversationState>(convState);
  useEffect(() => { convStateRef.current = convState; }, [convState]);

  // Derived: what the orb actually shows
  const orbState: OrbState = override ?? baseState;

  // ── Refs ──────────────────────────────────────────────────────────────────
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadActiveRef = useRef(false);   // is VAD currently recording (user speaking)?
  const baseStateRef = useRef<OrbState>('connecting');
  const overrideRef = useRef<null | 'muted' | 'paused'>(null);
  const messagesRef = useRef<TutorMessage[]>([]);
  const isSpeakingRef = useRef(false);  // is TTS currently playing?

  useEffect(() => { baseStateRef.current = baseState; }, [baseState]);
  useEffect(() => { overrideRef.current = override; }, [override]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── Audio pipeline ────────────────────────────────────────────────────────
  const openMic = useCallback(async () => {
    if (streamRef.current) return; // already open
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      console.log('[AITutor] ✅ Mic opened, AudioContext state:', ctx.state);
    } catch (err) {
      console.error('[AITutor] ❌ Microphone access denied:', String(err));
    }
  }, []);

  const closeMic = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    vadActiveRef.current = false;
  }, []);

  // ── VAD loop ──────────────────────────────────────────────────────────────
  const startVoiceRecording = useCallback(() => {
    if (vadActiveRef.current || !streamRef.current) return;
    vadActiveRef.current = true;
    audioChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    console.log('[AITutor] 🎙 Recording started, mimeType:', mimeType);
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      vadActiveRef.current = false;
      if (overrideRef.current || !context) return;

      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      console.log('[AITutor] ⏹ Recording stopped, blob size:', blob.size, 'bytes, chunks:', audioChunksRef.current.length);
      if (blob.size < 1000) {
        console.log('[AITutor] ⚠️ Blob too small, skipping');
        setBaseState('listening');
        return;
      }

      setBaseState('thinking');
      setTranscriptLive('');
      try {
        console.log('[AITutor] 📤 Sending to ASR...');
        const transcribed = await tutor.transcribeAudio(blob, mimeType);
        console.log('[AITutor] 📝 ASR result:', JSON.stringify(transcribed));
        if (transcribed.trim()) {
          await processUserReplyRef.current(transcribed);
        } else {
          console.log('[AITutor] ⚠️ ASR returned empty text');
          setAiSubtitle('没听清，再说一遍？');
          setBaseState('listening');
          setTimeout(() => setAiSubtitle(''), 2500);
        }
      } catch (err) {
        console.log('[AITutor] ❌ ASR error:', String(err));
        setBaseState('listening');
      }
    };

    recorder.start(100);
    setBaseState('active');
  }, [context]); // processUserReply added below after definition

  const stopVoiceRecording = useCallback(() => {
    if (!vadActiveRef.current) return;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    mediaRecorderRef.current?.stop();
  }, []);

  const runVadLoop = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);

    const tick = () => {
      animFrameRef.current = requestAnimationFrame(tick);
      if (!analyserRef.current) return;

      analyserRef.current.getByteFrequencyData(data);
      const amplitude = data.reduce((a, b) => a + b, 0) / data.length / 128;

      const currentBase = baseStateRef.current;
      const currentOverride = overrideRef.current;

      // Don't process VAD when overridden, thinking, speaking, or connecting
      if (currentOverride || isSpeakingRef.current ||
          currentBase === 'thinking' || currentBase === 'connecting' || currentBase === 'speaking') {
        return;
      }

      if (!vadActiveRef.current) {
        // Waiting to detect voice
        if (currentBase === 'listening' && amplitude > VAD_VOICE_THRESHOLD) {
          startVoiceRecording();
        }
      } else {
        // Currently recording — watch for silence
        if (amplitude < VAD_SILENCE_THRESHOLD) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              stopVoiceRecording();
            }, VAD_SILENCE_DURATION);
          }
        } else {
          // Voice detected again — cancel silence timer
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
      }
    };

    tick();
  }, [startVoiceRecording, stopVoiceRecording]);

  // ── Speak helper ──────────────────────────────────────────────────────────
  const speak = useCallback(async (text: string) => {
    if (overrideRef.current === 'paused') return;
    isSpeakingRef.current = true;
    setBaseState('speaking');
    setAiSubtitle(text);
    try {
      await tutor.speak(text);
    } catch {
      // silence — speak() already falls back internally
    }
    isSpeakingRef.current = false;
    // iOS suspends AudioContext when system audio (TTS) plays; resume it so VAD keeps working
    const ctxState = audioCtxRef.current?.state ?? 'none';
    console.log('[AITutor] 🔊 TTS done, AudioContext state:', ctxState);
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      try {
        await audioCtxRef.current.resume();
        console.log('[AITutor] ▶️ AudioContext resumed');
      } catch (_) { /* best-effort */ }
    }
    if (!overrideRef.current) {
      setBaseState('listening');
      setAiSubtitle('');
    }
  }, []);

  // ── Process user reply ────────────────────────────────────────────────────
  const processUserReply = useCallback(async (userText: string) => {
    if (!context || !userText.trim()) return;

    const userMsg: TutorMessage = { id: crypto.randomUUID(), role: 'user', text: userText };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);

    // Increment attempt count BEFORE calling AI so backend knows how many tries
    const stateBeforeCall: ConversationState = {
      ...convStateRef.current,
      attemptCount: convStateRef.current.attemptCount + 1,
    };
    setConvState(stateBeforeCall);
    convStateRef.current = stateBeforeCall;

    setBaseState('thinking');
    setAiSubtitle('');
    console.log('[AITutor] 💬 Sending to LLM, user text:', userText);
    try {
      // Inject authoritative state so backend knows current word / attempt
      const contextWithState: SessionContext = {
        ...context,
        conversationState: stateBeforeCall,
      };

      const { reply, stateUpdate } = await tutor.chat(updated, contextWithState);
      console.log('[AITutor] 🤖 LLM reply:', reply.slice(0, 80));

      const aiMsg: TutorMessage = { id: crypto.randomUUID(), role: 'ai', text: reply };
      setMessages(prev => [...prev, aiMsg]);
      setLastAIQuestion(reply);

      // Apply state update: advance word, mark mastery, update phase
      const nextState = applyStateUpdate(stateBeforeCall, stateUpdate, context.markedWords);
      setConvState(nextState);
      convStateRef.current = nextState;
      setCurrentIndex(nextState.currentWordIndex);

      await speak(reply);
    } catch (err) {
      console.log('[AITutor] ❌ LLM/TTS error:', String(err));
      const msg = err instanceof Error ? err.message : '';
      let hint = '出错了，请稍后再试';
      if (msg === 'DAILY_LIMIT')        hint = '今日对话次数已用完，明天再来～';
      else if (msg === 'MONTHLY_LIMIT') hint = '本月对话次数已用完';
      else if (msg === 'UNAUTHORIZED')  hint = '请先登录';
      setAiSubtitle(hint);
      setBaseState('listening');
      setTimeout(() => setAiSubtitle(''), 4000);
    }
  }, [context, speak]);

  // Fix circular ref: startVoiceRecording's recorder.onstop uses processUserReply
  // We store a stable ref to processUserReply so the recorder.onstop can call it.
  const processUserReplyRef = useRef(processUserReply);
  useEffect(() => { processUserReplyRef.current = processUserReply; }, [processUserReply]);

  // ── Session start ─────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!context || isSessionStarted) return;
    setIsSessionStarted(true);

    // Compute opening text BEFORE awaiting mic — it's a synchronous template,
    // doesn't need the mic or any network call.
    const openingText = tutor.getOpeningMessage(context);
    const openingMsg: TutorMessage = { id: crypto.randomUUID(), role: 'ai', text: openingText };
    setMessages([openingMsg]);
    setLastAIQuestion(openingText);

    // Open mic in parallel with first TTS so the user doesn't perceive any wait.
    // Mic permission prompt (if any) and TTS network call overlap.
    setBaseState('connecting');
    const micReady = openMic();

    // Kick off TTS speech immediately — speak() handles the network fetch + audio.
    // The "connecting" orb state stays visible only as long as the TTS request
    // takes; no artificial setTimeout delay.
    await Promise.all([micReady, speak(openingText)]);

    // After AI finishes opening, start VAD
    if (!overrideRef.current) runVadLoop();
  }, [context, isSessionStarted, openMic, speak, runVadLoop]);

  // ── Manual voice send (user taps "done speaking") ────────────────────────
  const stopAndSend = useCallback(() => {
    if (!vadActiveRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
  }, []);

  // ── Text send ─────────────────────────────────────────────────────────────
  const sendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput('');
    if (overrideRef.current !== 'paused') await processUserReply(text);
  }, [textInput, processUserReply]);

  // ── User controls ─────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setOverride(prev => {
      if (prev === 'muted') {
        // unmute → back to listening
        setBaseState('listening');
        return null;
      }
      // mute → stop any recording in progress
      if (vadActiveRef.current) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        mediaRecorderRef.current?.stop();
      }
      // Stop TTS
      tutor.stopSpeaking();
      isSpeakingRef.current = false;
      return 'muted';
    });
  }, []);

  const togglePause = useCallback(() => {
    setOverride(prev => {
      if (prev === 'paused') {
        // resume → restart VAD loop
        setBaseState('listening');
        setTimeout(() => runVadLoop(), 0);
        return null;
      }
      // pause → stop everything
      tutor.stopSpeaking();
      isSpeakingRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      if (vadActiveRef.current) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        mediaRecorderRef.current?.stop();
      }
      return 'paused';
    });
  }, [runVadLoop]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      tutor.stopSpeaking();
      closeMic();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [closeMic]);

  // Reset on close
  useEffect(() => {
    if (!context) {
      setBaseState('connecting');
      setOverride(null);
      setAiSubtitle('');
      setTranscriptLive('');
      setMessages([]);
      setCurrentIndex(0);
      setIsSessionStarted(false);
      setLastAIQuestion('');
      const fresh = buildInitialConvState([]);
      setConvState(fresh);
      convStateRef.current = fresh;
    }
  }, [context]);

  return {
    orbState,
    aiSubtitle,
    transcriptLive,
    messages,
    currentIndex,
    inputMode,
    setInputMode,
    textInput,
    setTextInput,
    sendText,
    stopAndSend,
    startSession,
    isSessionStarted,
    toggleMute,
    togglePause,
    lastAIQuestion,
    /** Exposed for word-progress chips in UI */
    convState,
  };
}
