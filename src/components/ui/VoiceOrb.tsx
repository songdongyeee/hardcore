import { motion, AnimatePresence } from 'framer-motion';
import type { OrbState } from '@/services/aiTutor/index';

interface VoiceOrbProps {
  state: OrbState;
  amplitude?: number; // 0–1, driven by live audio level
}

const PALETTE: Record<OrbState, { core: string; mid: string; outer: string; ripple: string }> = {
  idle: {
    core: '#6366f1',
    mid: 'rgba(99,102,241,0.28)',
    outer: 'rgba(99,102,241,0.09)',
    ripple: 'rgba(99,102,241,0.35)',
  },
  listening: {
    core: '#22c55e',
    mid: 'rgba(34,197,94,0.30)',
    outer: 'rgba(34,197,94,0.09)',
    ripple: 'rgba(34,197,94,0.35)',
  },
  speaking: {
    core: '#a855f7',
    mid: 'rgba(168,85,247,0.32)',
    outer: 'rgba(168,85,247,0.10)',
    ripple: 'rgba(168,85,247,0.38)',
  },
  thinking: {
    core: '#f59e0b',
    mid: 'rgba(245,158,11,0.26)',
    outer: 'rgba(245,158,11,0.08)',
    ripple: 'rgba(245,158,11,0.30)',
  },
};

const IDLE_SCALE = [1, 1.06, 1];
const LISTENING_SCALE = [0.96, 1.08, 0.96];
const SPEAKING_SCALE = [1, 1.14, 0.95, 1.10, 1];
const THINKING_SCALE = [1, 1.03, 1];

function getScaleKeyframes(state: OrbState, amplitude: number): number[] {
  if (state === 'speaking') {
    const boost = 1 + amplitude * 0.18;
    return SPEAKING_SCALE.map(v => v * boost);
  }
  if (state === 'listening') return LISTENING_SCALE;
  if (state === 'thinking') return THINKING_SCALE;
  return IDLE_SCALE;
}

function getDuration(state: OrbState): number {
  if (state === 'speaking') return 0.9;
  if (state === 'listening') return 1.2;
  if (state === 'thinking') return 2.4;
  return 3.2;
}

export function VoiceOrb({ state, amplitude = 0 }: VoiceOrbProps) {
  const palette = PALETTE[state];
  const scaleKF = getScaleKeyframes(state, amplitude);
  const duration = getDuration(state);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>

      {/* ── Outer ambient glow ── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 240,
          height: 240,
          background: `radial-gradient(circle, ${palette.outer} 0%, transparent 70%)`,
          filter: 'blur(32px)',
        }}
        animate={{ scale: scaleKF, opacity: state === 'idle' ? [0.6, 1, 0.6] : 1 }}
        transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ── Mid glow ring ── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 168,
          height: 168,
          background: `radial-gradient(circle, ${palette.mid} 0%, transparent 75%)`,
          filter: 'blur(16px)',
        }}
        animate={{ scale: scaleKF }}
        transition={{ duration, repeat: Infinity, ease: 'easeInOut', delay: 0.1 }}
      />

      {/* ── Ripple rings (speaking only) ── */}
      <AnimatePresence>
        {state === 'speaking' && [0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="absolute rounded-full border"
            style={{ width: 110, height: 110, borderColor: palette.ripple }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 2.6, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.52, ease: 'easeOut' }}
          />
        ))}
      </AnimatePresence>

      {/* ── Listening pulse ring ── */}
      <AnimatePresence>
        {state === 'listening' && (
          <motion.div
            className="absolute rounded-full border-2"
            style={{ width: 116, height: 116, borderColor: palette.ripple }}
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 1.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* ── Core sphere ── */}
      <motion.div
        className="relative rounded-full"
        style={{
          width: 108,
          height: 108,
          background: `radial-gradient(circle at 35% 32%, rgba(255,255,255,0.38) 0%, ${palette.core} 45%, color-mix(in srgb, ${palette.core}, #000 35%) 100%)`,
          boxShadow: `0 0 40px 8px ${palette.mid}, 0 0 0 1px rgba(255,255,255,0.08) inset`,
        }}
        animate={{
          scale: scaleKF,
          // thinking: subtle rotation via background-position trick using filter hue
          filter: state === 'thinking'
            ? ['hue-rotate(0deg)', 'hue-rotate(20deg)', 'hue-rotate(0deg)']
            : 'hue-rotate(0deg)',
        }}
        transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Inner highlight */}
        <div
          className="absolute rounded-full"
          style={{
            width: 32,
            height: 32,
            top: 14,
            left: 18,
            background: 'radial-gradient(circle, rgba(255,255,255,0.55) 0%, transparent 100%)',
            filter: 'blur(4px)',
          }}
        />
      </motion.div>

    </div>
  );
}
