import type { OrbState } from '@/services/aiTutor/index';

interface VoiceOrbProps {
  state: OrbState;
  size?: number;
  onClick?: () => void;
}

const PALETTE: Record<OrbState, { core: string; mid: string; shell: string; halo: string }> = {
  idle:       { core: '#818cf8', mid: '#a5b4fc', shell: '#312e81', halo: 'rgba(99,102,241,.30)' },
  listening:  { core: '#34d399', mid: '#86efac', shell: '#064e3b', halo: 'rgba(34,197,94,.30)' },
  active:     { core: '#34d399', mid: '#86efac', shell: '#064e3b', halo: 'rgba(34,197,94,.38)' },
  thinking:   { core: '#fbbf24', mid: '#fde68a', shell: '#451a03', halo: 'rgba(245,158,11,.30)' },
  speaking:   { core: '#c084fc', mid: '#f0abfc', shell: '#3b0764', halo: 'rgba(168,85,247,.40)' },
  connecting: { core: '#a5b4fc', mid: '#c7d2fe', shell: '#1e1b4b', halo: 'rgba(129,140,248,.25)' },
  muted:      { core: '#71717a', mid: '#a1a1aa', shell: '#18181b', halo: 'rgba(82,82,91,.10)' },
  paused:     { core: '#3f3f46', mid: '#52525b', shell: '#09090b', halo: 'rgba(63,63,70,.05)' },
};

const PROFILE: Record<OrbState, {
  morph: 'soft' | 'med' | 'extreme';
  morphDur: number;
  rotA: number;
  rotB: number;
  breath: string;
  inward: boolean;
  rings: number;
  voice: boolean;
  jitter: boolean;
}> = {
  idle:       { morph: 'soft',    morphDur: 11, rotA:  32, rotB: -46, breath: 'halo-breath',      inward: false, rings: 0, voice: false, jitter: false },
  listening:  { morph: 'soft',    morphDur:  9, rotA:  22, rotB: -32, breath: 'halo-breath',      inward: true,  rings: 0, voice: false, jitter: false },
  active:     { morph: 'med',     morphDur:  5, rotA:  12, rotB: -16, breath: 'halo-breath-fast', inward: false, rings: 0, voice: true,  jitter: false },
  thinking:   { morph: 'extreme', morphDur:  5, rotA:  10, rotB: -14, breath: 'halo-breath-fast', inward: false, rings: 0, voice: false, jitter: true  },
  speaking:   { morph: 'med',     morphDur:  6, rotA:  16, rotB: -22, breath: 'halo-breath-fast', inward: false, rings: 3, voice: false, jitter: false },
  connecting: { morph: 'soft',    morphDur:  8, rotA:  20, rotB: -28, breath: 'halo-breath',      inward: false, rings: 0, voice: false, jitter: false },
  muted:      { morph: 'soft',    morphDur: 18, rotA:  60, rotB: -80, breath: 'halo-breath',      inward: false, rings: 0, voice: false, jitter: false },
  paused:     { morph: 'soft',    morphDur:  0, rotA:   0, rotB:   0, breath: '',                 inward: false, rings: 0, voice: false, jitter: false },
};

export function VoiceOrb({ state, size = 210, onClick }: VoiceOrbProps) {
  const c = PALETTE[state] ?? PALETTE.idle;
  const p = PROFILE[state] ?? PROFILE.idle;
  const frozen = p.morphDur === 0;
  const dim = state === 'muted' || state === 'paused';
  const clickable = state === 'speaking' || state === 'muted';

  // The halo breathes at 60% of the morph cycle speed
  const haloAnim = frozen || !p.breath
    ? 'none'
    : `${p.breath} ${p.morphDur * 0.6}s ease-in-out infinite`;

  // The blob silhouette morphs
  const bodyAnim = frozen
    ? 'none'
    : `blob-morph-${p.morph} ${p.morphDur}s ease-in-out infinite`;

  const rotADur = Math.abs(p.rotA);
  const rotBDur = Math.abs(p.rotB);

  // Ripple border color: bump up the halo opacity
  const rippleColor = c.halo.replace(/[\d.]+\)$/, '.55)');

  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        position: 'relative',
        width: size,
        height: size,
        opacity: dim ? 0.55 : 1,
        transition: 'opacity 600ms ease',
        cursor: clickable ? 'pointer' : 'default',
        flexShrink: 0,
      }}
    >
      {/* ── Outer halo glow ──────────────────────────────────────────────────
          Radial gradient naturally fades to transparent — no border-radius
          needed for circular appearance, so filter:blur works correctly on iOS.
      */}
      <div style={{
        position: 'absolute',
        top: '-14%', right: '-14%', bottom: '-14%', left: '-14%',
        background: `radial-gradient(circle, ${c.halo} 0%, transparent 65%)`,
        WebkitFilter: 'blur(18px)',
        filter: 'blur(18px)',
        animation: haloAnim,
        pointerEvents: 'none',
      }} />

      {/* ── Speaking: outward ripple rings ──────────────────────────────── */}
      {Array.from({ length: p.rings }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          borderRadius: '50%',
          border: `1.5px solid ${rippleColor}`,
          animation: 'liquid-ring 2.6s cubic-bezier(0.16,1,0.30,1) infinite',
          animationDelay: `${i * 0.85}s`,
          opacity: 0,
          pointerEvents: 'none',
        }} />
      ))}

      {/* ── Static circle clipper ─────────────────────────────────────────
          KEY iOS FIX: This wrapper has a STATIC (non-animated) border-radius:50%
          and overflow:hidden. iOS WkWebView correctly clips children to a static
          border-radius. The blob animation lives INSIDE this clipper on the body
          div, so it never needs to rely on the broken "overflow:hidden +
          animated border-radius" path.
      */}
      <div style={{
        position: 'absolute',
        top: 0, right: 0, bottom: 0, left: 0,
        borderRadius: '50%',
        overflow: 'hidden',
      }}>
        {/* ── Blob body: animated shell background ────────────────────────
            The blob-morph animation changes this div's border-radius,
            making the shell color (c.shell) appear as an organic blob shape.
            Children (inner gradients) are clipped to the parent circle clipper.
        */}
        <div style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          background: c.shell,
          borderRadius: '50%',
          animation: bodyAnim,
        }}>
          {/* Inner gradient A — large ellipse, slowly rotates */}
          <div style={{
            position: 'absolute',
            top: '-25%', right: '-25%', bottom: '-25%', left: '-25%',
            background: `radial-gradient(ellipse 55% 65% at 30% 38%, ${c.core} 0%, ${c.core}00 55%)`,
            animation: frozen || rotADur === 0
              ? 'none'
              : `liquid-rot ${rotADur}s linear infinite${p.rotA < 0 ? ' reverse' : ''}`,
            mixBlendMode: 'screen',
            WebkitFilter: 'blur(6px)',
            filter: 'blur(6px)',
          }} />

          {/* Inner gradient B — counter-rotates at different speed */}
          <div style={{
            position: 'absolute',
            top: '-25%', right: '-25%', bottom: '-25%', left: '-25%',
            background: `radial-gradient(ellipse 50% 60% at 68% 62%, ${c.mid} 0%, ${c.mid}00 50%)`,
            animation: frozen || rotBDur === 0
              ? 'none'
              : `liquid-rot ${rotBDur}s linear infinite${p.rotB < 0 ? ' reverse' : ''}`,
            mixBlendMode: 'screen',
            WebkitFilter: 'blur(7px)',
            filter: 'blur(7px)',
          }} />

          {/* Active — voice-amplitude pulse on tight bright core */}
          {p.voice && (
            <div style={{
              position: 'absolute',
              top: '15%', right: '15%', bottom: '15%', left: '15%',
              background: `radial-gradient(circle, ${c.mid} 0%, ${c.mid}00 60%)`,
              animation: 'voice-amp 1.4s ease-in-out infinite',
              mixBlendMode: 'screen',
              WebkitFilter: 'blur(8px)',
              filter: 'blur(8px)',
              borderRadius: '50%',
            }} />
          )}

          {/* Listening — concentric inward shimmer */}
          {p.inward && (
            <>
              <div style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0, left: 0,
                borderRadius: '50%',
                background: `radial-gradient(circle, transparent 35%, ${c.mid}55 65%, transparent 85%)`,
                animation: 'liquid-inward 2.6s ease-in-out infinite',
                mixBlendMode: 'screen',
              }} />
              <div style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0, left: 0,
                borderRadius: '50%',
                background: `radial-gradient(circle, transparent 50%, ${c.core}40 75%, transparent 95%)`,
                animation: 'liquid-inward 2.6s ease-in-out infinite',
                animationDelay: '-1.3s',
                mixBlendMode: 'screen',
              }} />
            </>
          )}

          {/* Thinking — two asymmetric jitter blobs */}
          {p.jitter && (
            <>
              <div style={{
                position: 'absolute',
                width: '52%', height: '52%', left: '18%', top: '12%',
                background: `radial-gradient(circle, ${c.mid} 0%, transparent 65%)`,
                WebkitFilter: 'blur(11px)',
                filter: 'blur(11px)',
                borderRadius: '50%',
                mixBlendMode: 'screen',
                animation: 'think-jitter-1 2.4s ease-in-out infinite',
              }} />
              <div style={{
                position: 'absolute',
                width: '46%', height: '46%', right: '14%', bottom: '18%',
                background: `radial-gradient(circle, ${c.core} 0%, transparent 65%)`,
                WebkitFilter: 'blur(13px)',
                filter: 'blur(13px)',
                borderRadius: '50%',
                mixBlendMode: 'screen',
                animation: 'think-jitter-2 1.8s ease-in-out infinite',
              }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
