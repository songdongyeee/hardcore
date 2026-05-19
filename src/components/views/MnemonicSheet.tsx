import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Mic, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceOrb } from '@/components/ui/VoiceOrb';
import { useAITutor } from '@/hooks/useAITutor';
import type { MarkedWord } from '@/App';
import type { TranscriptSegment } from '@/data/transcript';

interface MnemonicSheetProps {
  isOpen: boolean;
  onClose: () => void;
  markedWords: MarkedWord[];
  transcript: TranscriptSegment[];
  materialTitle?: string;
}

export function MnemonicSheet({ isOpen, onClose, markedWords, transcript, materialTitle }: MnemonicSheetProps) {
  const context = { markedWords, transcript, materialTitle };

  const {
    orbState, subtitle, messages,
    isRecording, inputMode, setInputMode,
    textInput, setTextInput, sendText,
    amplitude, startRecording, stopRecording,
    startSession, isSessionStarted,
  } = useAITutor(isOpen ? context : null);

  // Start session once sheet opens
  useEffect(() => {
    if (isOpen && !isSessionStarted) {
      const t = setTimeout(() => startSession(), 400);
      return () => clearTimeout(t);
    }
  }, [isOpen, isSessionStarted, startSession]);

  const textInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputMode === 'text') textInputRef.current?.focus();
  }, [inputMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') sendText();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop (shows AnalysisView underneath) ── */}
          <motion.div
            className="absolute inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* ── Sheet ── */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 z-50 flex flex-col bg-zinc-950 rounded-t-[28px] overflow-hidden"
            style={{ height: '88dvh' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 shrink-0">
              <div className="w-9 h-1 rounded-full bg-zinc-700" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-2 pb-3 shrink-0">
              <button
                onClick={onClose}
                className="p-2 -ml-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X size={20} />
              </button>
              <span className="text-sm font-semibold text-zinc-300 tracking-wide">AI 助记</span>
              <div className="w-9" />
            </div>

            {/* ── Marked word chips ── */}
            <div className="px-5 pb-3 shrink-0">
              <div className="flex flex-wrap gap-2">
                {markedWords.map((w, i) => (
                  <span
                    key={w.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-medium"
                  >
                    <span className="text-amber-500/60 text-[10px]">{i + 1}</span>
                    {w.text}
                  </span>
                ))}
              </div>
            </div>

            <div className="w-full h-px bg-zinc-800/60 shrink-0" />

            {/* ── Orb + subtitle (center hero area) ── */}
            <div className="flex-1 flex flex-col items-center justify-center gap-5 min-h-0 px-6">
              <VoiceOrb state={orbState} amplitude={amplitude} />

              {/* Subtitle: current AI speech */}
              <div className="h-16 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {subtitle ? (
                    <motion.p
                      key={subtitle.slice(0, 20)}
                      className="text-zinc-300 text-center text-[15px] leading-relaxed max-w-[280px]"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25 }}
                    >
                      {subtitle}
                    </motion.p>
                  ) : (
                    <motion.p
                      key="status"
                      className="text-zinc-600 text-sm text-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {orbState === 'idle' && messages.length > 0 && '轮到你了'}
                      {orbState === 'listening' && '正在听...'}
                      {orbState === 'thinking' && '思考中...'}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ── Bottom controls ── */}
            <div
              className="shrink-0 px-6 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-4 border-t border-zinc-900"
            >
              <AnimatePresence mode="wait">
                {inputMode === 'voice' ? (
                  <motion.div
                    key="voice"
                    className="flex items-center justify-center gap-5"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                  >
                    {/* Mic button – hold to record */}
                    <motion.button
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-full font-semibold text-sm transition-colors select-none',
                        isRecording
                          ? 'bg-red-500/20 border-2 border-red-400 text-red-300 px-8 py-4'
                          : 'bg-white text-black px-8 py-4'
                      )}
                      onPointerDown={e => { e.preventDefault(); startRecording(); }}
                      onPointerUp={stopRecording}
                      onPointerLeave={stopRecording}
                      whileTap={{ scale: 0.96 }}
                    >
                      <Mic size={18} className={isRecording ? 'animate-pulse' : ''} />
                      <span>{isRecording ? '松开发送' : '按住说话'}</span>
                    </motion.button>

                    {/* Toggle to text input */}
                    <button
                      onClick={() => setInputMode('text')}
                      className="p-3 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                    >
                      <Keyboard size={18} />
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="text"
                    className="flex items-center gap-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                  >
                    <input
                      ref={textInputRef}
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="输入你的回答..."
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-indigo-500/60"
                    />
                    <button
                      onClick={sendText}
                      disabled={!textInput.trim()}
                      className="p-3 rounded-full bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-500 transition-colors"
                    >
                      <Send size={18} />
                    </button>
                    {/* Toggle back to voice */}
                    <button
                      onClick={() => setInputMode('voice')}
                      className="p-3 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                    >
                      <Mic size={18} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
