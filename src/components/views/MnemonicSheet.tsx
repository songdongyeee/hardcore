import { useEffect, useRef, useLayoutEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VoiceOrb } from '@/components/ui/VoiceOrb';
import { useAITutor } from '@/hooks/useAITutor';
import type { MarkedWord } from '@/App';
import type { TranscriptSegment } from '@/data/transcript';
import type { OrbState } from '@/services/aiTutor/index';

interface MnemonicSheetProps {
  isOpen: boolean;
  onClose: () => void;
  markedWords: MarkedWord[];
  transcript: TranscriptSegment[];
  materialTitle?: string;
}

const STATUS: Record<OrbState, { primary: string; hint: string }> = {
  connecting: { primary: '正在连接 AI 老师', hint: 'Connecting…' },
  idle:       { primary: '随时开始回答',    hint: 'Mic is open · just speak' },
  listening:  { primary: '请开始回答',      hint: '说完后点击发送' },
  active:     { primary: '正在录音...',     hint: '说完后点击发送' },
  thinking:   { primary: '思考中...',       hint: '' },
  speaking:   { primary: '正在解释',        hint: '轻触球体打断' },
  muted:      { primary: '已静音',          hint: '点击麦克风继续对话' },
  paused:     { primary: '已暂停',          hint: '点击继续按钮' },
};

// ── Icons (lucide inline SVG) ─────────────────────────────────────────────────
const IconX = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);
const IconKeyboard = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/>
    <path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/>
    <rect width="20" height="16" x="2" y="4" rx="2"/>
  </svg>
);
const IconPause = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>
  </svg>
);
const IconPlay = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.87l13-7.5a1 1 0 0 0 0-1.74l-13-7.5A1 1 0 0 0 7 4.5z"/>
  </svg>
);
const IconMic = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
  </svg>
);
const IconMicOff = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" x2="22" y1="2" y2="22"/>
    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/>
    <path d="M5 10v2a7 7 0 0 0 12 5"/>
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
    <line x1="12" x2="12" y1="19" y2="22"/>
  </svg>
);
const IconSend = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/>
    <path d="m21.854 2.147-10.94 10.939"/>
  </svg>
);

// ── CircleBtn ─────────────────────────────────────────────────────────────────
type BtnVariant = 'neutral' | 'danger' | 'primary';
const BTN_TONES: Record<BtnVariant, { bg: string; border: string; fg: string }> = {
  neutral: { bg: '#1f1f23', border: 'rgba(255,255,255,.08)', fg: '#d4d4d8' },
  danger:  { bg: 'rgba(244,63,94,.12)', border: 'rgba(244,63,94,.35)', fg: '#fda4af' },
  primary: { bg: 'rgba(99,102,241,.15)', border: 'rgba(99,102,241,.40)', fg: '#a5b4fc' },
};

function CircleBtn({
  icon, label, onClick, variant = 'neutral', size = 56, disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: number;
  disabled?: boolean;
}) {
  const t = BTN_TONES[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: size, height: size, borderRadius: 9999,
        background: disabled ? '#0e0e10' : t.bg,
        border: `1px solid ${disabled ? '#1f1f23' : t.border}`,
        color: disabled ? '#3f3f46' : t.fg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 180ms cubic-bezier(0.16,1,0.30,1)',
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
}

// ── WordChips ─────────────────────────────────────────────────────────────────
function WordChips({ words, currentIndex }: { words: string[]; currentIndex: number }) {
  return (
    <div style={{ padding: '0 20px 12px', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {words.map((w, i) => {
        const isCurrent = i === currentIndex;
        const isDone = i < currentIndex;
        return (
          <span key={w} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 9999,
            fontSize: 11.5, fontWeight: 500,
            background: isCurrent ? 'rgba(245,158,11,.18)' : isDone ? 'rgba(245,158,11,.06)' : 'rgba(245,158,11,.10)',
            border: `1px solid ${isCurrent ? 'rgba(245,158,11,.55)' : 'rgba(245,158,11,.22)'}`,
            color: isCurrent ? '#fde68a' : isDone ? '#a16207' : '#fcd34d',
            opacity: isDone ? 0.55 : 1,
            transition: 'all 240ms ease',
          }}>
            <span style={{ fontSize: 9, color: 'rgba(245,158,11,.6)' }}>{i + 1}</span>
            {w}
            {isDone && <span style={{ marginLeft: 2, fontSize: 10 }}>✓</span>}
          </span>
        );
      })}
    </div>
  );
}

// ── TypewriterSubtitle ────────────────────────────────────────────────────────
const LINE_HEIGHT = 22;

function TypewriterSubtitle({ text, speed = 32 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShown(0);
    setScrollY(0);
  }, [text]);

  useEffect(() => {
    if (!text || shown >= text.length) return;
    const t = setTimeout(() => setShown(s => s + 1), speed);
    return () => clearTimeout(t);
  }, [shown, text, speed]);

  useLayoutEffect(() => {
    if (!innerRef.current || !wrapRef.current) return;
    const over = Math.max(0, innerRef.current.scrollHeight - wrapRef.current.clientHeight);
    setScrollY(over);
  }, [shown, text]);

  const chars = text ? text.slice(0, shown).split('') : [];

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        height: LINE_HEIGHT * 2,
        overflow: 'hidden',
        maskImage: 'linear-gradient(180deg, transparent 0%, #000 26%, #000 100%)',
        WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 26%, #000 100%)',
        width: '100%',
      }}
    >
      <div
        ref={innerRef}
        style={{
          fontSize: 14.5,
          lineHeight: `${LINE_HEIGHT}px`,
          color: '#d4d4d8',
          textAlign: 'left',
          transform: `translateY(${-scrollY}px)`,
          transition: 'transform 280ms cubic-bezier(0.16,1,0.30,1)',
          willChange: 'transform',
          padding: '0 2px',
        }}
      >
        {chars.map((ch, i) => (
          <span key={i} style={{ animation: 'tw-char-in 220ms ease-out both' }}>{ch}</span>
        ))}
        {text && shown < text.length && (
          <span style={{
            display: 'inline-block', width: 2, height: '0.95em', verticalAlign: '-0.1em',
            marginLeft: 1, background: '#a1a1aa', animation: 'tw-cursor 1.1s steps(2) infinite',
          }} />
        )}
      </div>
    </div>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────────
export function MnemonicSheet({ isOpen, onClose, markedWords, transcript, materialTitle }: MnemonicSheetProps) {
  // Stable reference — prevents all hook callbacks from being recreated on every render
  const context = useMemo(
    () => ({ markedWords, transcript, materialTitle }),
    [markedWords, transcript, materialTitle],
  );

  const {
    orbState, aiSubtitle, transcriptLive,
    currentIndex, inputMode, setInputMode,
    textInput, setTextInput, sendText,
    stopAndSend,
    startSession, isSessionStarted,
    toggleMute, togglePause,
    lastAIQuestion,
  } = useAITutor(isOpen ? context : null);

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

  const words = markedWords.map(w => w.text);
  const status = STATUS[orbState] ?? STATUS.idle;
  const isConnecting = orbState === 'connecting';
  const showLiveDot = orbState === 'idle' || orbState === 'listening' || orbState === 'active';

  const handleOrbClick = () => {
    if (orbState === 'speaking') toggleMute();     // interrupt AI → listening
    else if (orbState === 'muted') toggleMute();   // unmute
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet — no overflow:hidden so halo can breathe; drag-handle/header don't need it */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 z-50 flex flex-col"
            style={{
              height: '88dvh',
              background: '#09090b',
              borderTop: '1px solid rgba(255,255,255,.08)',
              borderRadius: '28px 28px 0 0',
              boxShadow: '0 -24px 80px rgba(0,0,0,.78)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 shrink-0">
              <div style={{ width: 38, height: 4, borderRadius: 9999, background: '#3f3f46' }} />
            </div>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 12px' }} className="shrink-0">
              <button
                onClick={onClose}
                style={{
                  width: 36, height: 36, borderRadius: 9999, background: 'transparent', border: 'none',
                  color: '#71717a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <IconX />
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#52525b' }}>
                  STEP 02 · 弄懂
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#d4d4d8', marginTop: 2 }}>AI 助记</span>
              </div>
              <div style={{ width: 36 }} />
            </div>

            {/* Word chips */}
            <div className="shrink-0">
              <WordChips words={words} currentIndex={currentIndex} />
              <div style={{ height: 1, background: 'rgba(255,255,255,.05)', margin: '0 20px' }} />
            </div>

            {/* ── VOICE MODE ── */}
            {inputMode === 'voice' ? (
              <>
                {/* Center hero */}
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '4px 24px', minHeight: 0, gap: 0,
                }}>
                  {/* Orb */}
                  <VoiceOrb state={orbState} size={210} onClick={handleOrbClick} />

                  {/* Status pill */}
                  <div
                    key={orbState}
                    className="orb-status-in"
                    style={{ marginTop: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  >
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '6px 14px', borderRadius: 9999,
                      background: 'rgba(255,255,255,.04)',
                      border: '1px solid rgba(255,255,255,.06)',
                      fontSize: 12.5, fontWeight: 500, color: '#a1a1aa',
                    }}>
                      {showLiveDot && (
                        <span style={{
                          width: 6, height: 6, borderRadius: 9999,
                          background: '#22c55e', boxShadow: '0 0 8px #22c55e',
                          display: 'inline-block',
                        }} />
                      )}
                      {status.primary}
                    </span>
                    {status.hint && (
                      <span style={{ fontSize: 11, color: '#52525b', fontFamily: 'ui-monospace, monospace', letterSpacing: '.04em' }}>
                        {status.hint}
                      </span>
                    )}
                  </div>

                  {/* Done / Send capsule — shown while waiting or recording */}
                  {(orbState === 'listening' || orbState === 'active') && (
                    <button
                      onClick={stopAndSend}
                      disabled={orbState !== 'active'}
                      style={{
                        marginTop: 16,
                        padding: '10px 30px', borderRadius: 9999,
                        background: orbState === 'active'
                          ? 'rgba(34,197,94,.14)'
                          : 'rgba(255,255,255,.03)',
                        border: `1px solid ${orbState === 'active' ? 'rgba(34,197,94,.40)' : 'rgba(255,255,255,.07)'}`,
                        color: orbState === 'active' ? '#86efac' : '#3f3f46',
                        fontSize: 14, fontWeight: 500,
                        cursor: orbState === 'active' ? 'pointer' : 'default',
                        fontFamily: 'inherit',
                        transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease',
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        flexShrink: 0,
                      }}
                    >
                      {orbState === 'active' ? '说完了  ·  发送' : '等待中…'}
                    </button>
                  )}

                  {/* Subtitle / transcript area */}
                  <div style={{ width: 300, minHeight: 50, marginTop: 14, padding: '0 8px' }}>
                    {orbState === 'speaking' && aiSubtitle && (
                      <TypewriterSubtitle key={aiSubtitle} text={aiSubtitle} />
                    )}
                    {orbState === 'active' && transcriptLive && (
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#86efac', fontStyle: 'italic', textAlign: 'center' }}>
                        "{transcriptLive}<span style={{ opacity: 0.5 }}>|</span>"
                      </p>
                    )}
                    {orbState === 'thinking' && (
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ display: 'inline-flex', gap: 4, marginTop: 4 }}>
                          {[0, 1, 2].map(i => (
                            <span key={i} style={{
                              width: 6, height: 6, borderRadius: 9999, background: '#fcd34d',
                              animation: `connect-breathe 1s ease-in-out ${i * 0.18}s infinite`,
                              display: 'inline-block',
                            }} />
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom controls: Keyboard / Pause / Mic */}
                <div style={{
                  padding: 'calc(18px) 28px calc(20px + env(safe-area-inset-bottom))',
                  borderTop: '1px solid rgba(255,255,255,.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 20,
                }} className="shrink-0">
                  <CircleBtn
                    icon={<IconKeyboard />}
                    label="切换到键盘输入"
                    variant="neutral"
                    disabled={isConnecting}
                    onClick={() => setInputMode('text')}
                  />
                  <CircleBtn
                    icon={orbState === 'paused' ? <IconPlay /> : <IconPause />}
                    label={orbState === 'paused' ? '继续' : '暂停'}
                    variant={orbState === 'paused' ? 'primary' : 'neutral'}
                    disabled={isConnecting}
                    onClick={togglePause}
                    size={64}
                  />
                  <CircleBtn
                    icon={orbState === 'muted' ? <IconMicOff /> : <IconMic />}
                    label={orbState === 'muted' ? '取消静音' : '静音'}
                    variant={orbState === 'muted' ? 'danger' : 'neutral'}
                    disabled={isConnecting}
                    onClick={toggleMute}
                  />
                </div>
              </>
            ) : (
              /* ── TEXT MODE ── */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '8px 20px 0' }}>
                {/* Mini orb + last AI question */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0' }}>
                  <VoiceOrb state="idle" size={110} />
                  {lastAIQuestion && (
                    <p style={{ margin: '14px 0 0', fontSize: 14, color: '#a1a1aa', maxWidth: 280, textAlign: 'center', lineHeight: 1.55 }}>
                      AI 已问：<span style={{ color: '#fafafa' }}>「{lastAIQuestion}」</span>
                    </p>
                  )}
                </div>

                {/* Text input + switch back to voice */}
                <div style={{ padding: '12px 0 calc(20px + env(safe-area-inset-bottom))' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: '#18181b', border: '1px solid rgba(255,255,255,.08)',
                    borderRadius: 9999, padding: '6px 6px 6px 18px',
                  }}>
                    <input
                      ref={textInputRef}
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') sendText(); }}
                      placeholder="输入你的回答..."
                      style={{
                        flex: 1, background: 'transparent', border: 'none', outline: 'none',
                        color: '#fafafa', fontSize: 14, fontFamily: 'inherit', padding: '10px 0',
                      }}
                    />
                    <button
                      onClick={sendText}
                      disabled={!textInput.trim()}
                      style={{
                        width: 40, height: 40, borderRadius: 9999, background: '#6366f1', color: '#fff',
                        border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        cursor: textInput.trim() ? 'pointer' : 'not-allowed', opacity: textInput.trim() ? 1 : 0.4,
                      }}
                    >
                      <IconSend />
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                    <button
                      onClick={() => setInputMode('voice')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '8px 14px', borderRadius: 9999,
                        background: 'transparent', border: '1px solid rgba(255,255,255,.08)',
                        color: '#a1a1aa', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      <IconMic size={15} /> 切回语音
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
