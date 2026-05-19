import { useState, useRef, useCallback, useEffect } from 'react';
import type { OrbState, TutorMessage, SessionContext } from '@/services/aiTutor/index';
import { AliyunTutorService } from '@/services/aiTutor/aliyunTutor';

const tutor = new AliyunTutorService('https://zjcnex.top');

export type InputMode = 'voice' | 'text';

export function useAITutor(context: SessionContext | null) {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [subtitle, setSubtitle] = useState('');
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  const [textInput, setTextInput] = useState('');
  const [amplitude, setAmplitude] = useState(0);
  const [isSessionStarted, setIsSessionStarted] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Amplitude tracker for orb reactivity ──────────────────────────────────
  const startAmplitudeTracking = (stream: MediaStream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAmplitude(avg / 128); // normalise 0–1
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const stopAmplitudeTracking = () => {
    cancelAnimationFrame(animFrameRef.current);
    setAmplitude(0);
  };

  // ── Speak helper ──────────────────────────────────────────────────────────
  const speak = useCallback(async (text: string) => {
    setOrbState('speaking');
    setSubtitle(text);
    await tutor.speak(text);
    setOrbState('idle');
    setSubtitle('');
  }, []);

  // ── Session start: play opening message ───────────────────────────────────
  const startSession = useCallback(async () => {
    if (!context || isSessionStarted) return;
    setIsSessionStarted(true);

    const openingText = tutor.getOpeningMessage(context);
    const openingMsg: TutorMessage = {
      id: crypto.randomUUID(),
      role: 'ai',
      text: openingText,
    };
    setMessages([openingMsg]);
    await speak(openingText);
  }, [context, isSessionStarted, speak]);

  // ── Process user reply (text or transcribed voice) ────────────────────────
  // Use a ref to capture the latest messages list without stale closure issues
  const messagesRef = useRef<TutorMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const processUserReply = useCallback(async (userText: string) => {
    if (!context || !userText.trim()) return;

    const userMsg: TutorMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText,
    };

    // Build updated list using ref to avoid stale closure, then commit to state
    const messagesWithUser = [...messagesRef.current, userMsg];
    setMessages(messagesWithUser);

    // Fire AI response outside of setState — avoids React strict-mode double-invoke bug
    setOrbState('thinking');
    setSubtitle('');
    try {
      const reply = await tutor.chat(messagesWithUser, context);
      const aiMsg: TutorMessage = { id: crypto.randomUUID(), role: 'ai', text: reply };
      setMessages(prev => [...prev, aiMsg]);
      await speak(reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      let hint = '出错了，请稍后再试';
      if (msg === 'DAILY_LIMIT') hint = '今日对话次数已用完，明天再来～';
      else if (msg === 'MONTHLY_LIMIT') hint = '本月对话次数已用完';
      else if (msg === 'UNAUTHORIZED') hint = '请先登录';
      setSubtitle(hint);
      setOrbState('idle');
      setTimeout(() => setSubtitle(''), 4000);
    }
  }, [context, speak]);

  // ── Voice recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startAmplitudeTracking(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopAmplitudeTracking();
        streamRef.current?.getTracks().forEach(t => t.stop());

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setOrbState('thinking');

        const transcribed = await tutor.transcribeAudio(blob, mimeType);
        await processUserReply(transcribed);
      };

      recorder.start();
      setIsRecording(true);
      setOrbState('listening');
    } catch {
      console.error('Microphone access denied');
    }
  }, [isRecording, processUserReply]);

  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    setOrbState('thinking');
  }, [isRecording]);

  // ── Text send ─────────────────────────────────────────────────────────────
  const sendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput('');
    await processUserReply(text);
  }, [textInput, processUserReply]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      tutor.stopSpeaking();
      stopAmplitudeTracking();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return {
    orbState,
    subtitle,
    messages,
    isRecording,
    inputMode,
    setInputMode,
    textInput,
    setTextInput,
    sendText,
    amplitude,
    startRecording,
    stopRecording,
    startSession,
    isSessionStarted,
  };
}
