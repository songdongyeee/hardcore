import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, RotateCcw, RotateCw, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcript } from "@/data/transcript";

interface ListeningViewProps {
  onBack: () => void;
  onNextPhase: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (time: number) => void;
}

export function ListeningView({ 
  onBack, 
  onNextPhase, 
  audioRef, 
  currentTime, 
  isPlaying,
  togglePlay,
  seek
}: ListeningViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);

  // Sync active segment and scroll
  useEffect(() => {
    const index = transcript.findIndex(seg => currentTime >= seg.start && currentTime <= seg.end);
    setActiveSegmentIndex(index);

    if (index !== -1 && containerRef.current && scrollBoxRef.current) {
        const activeEl = containerRef.current.children[index] as HTMLElement;
        if (activeEl) {
            // Logic for ghost cursor highlighting would go here using activeEl
            // For MVP React migration, we'll focus on text highlighting first
            
            // Simple Scroll into view logic
            const rect = activeEl.getBoundingClientRect();
            const boxRect = scrollBoxRef.current.getBoundingClientRect();
             // Only scroll if out of "center" zone to avoid jitter
            if (rect.top < boxRect.top + boxRect.height * 0.3 || rect.bottom > boxRect.top + boxRect.height * 0.7) {
                 activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
  }, [currentTime]);

  const progress = audioRef.current?.duration ? (currentTime / audioRef.current.duration) * 100 : 0;

  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* Nav */}
      <div className="px-6 py-6 flex justify-between items-center border-b border-zinc-900 bg-black">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-medium text-zinc-500 tracking-widest uppercase">Phase 1</span>
          <span className="text-sm font-semibold text-white tracking-tight">Blind Listening</span>
        </div>
        <div className="w-8"></div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 flex items-start justify-center relative" ref={scrollBoxRef}>
        <div ref={containerRef} className="space-y-6 text-lg md:text-xl font-medium leading-relaxed tracking-tight text-center max-w-sm mx-auto">
            {transcript.map((seg, idx) => {
                const isActive = idx === activeSegmentIndex;
                return (
                    <p 
                        key={idx}
                        className={cn(
                            "blur-text transition-all duration-500 cursor-pointer",
                            isActive ? "active text-shadow-glow" : "blur-[8px] text-zinc-400 select-none"
                        )}
                        style={isActive ? { filter: 'none', color: '#fff', textShadow: '0 0 16px rgba(167, 139, 250, 0.4)' } : {}}
                        onClick={() => seek(seg.start)}
                    >
                        {seg.text}
                    </p>
                );
            })}
        </div>
      </div>

      {/* Controls */}
      <div className="p-8 pb-10 bg-gradient-to-t from-black via-black to-transparent">
        {/* Scrubber */}
        <div 
            className="w-full h-1 bg-zinc-800 rounded-full mb-8 relative group cursor-pointer"
            onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const p = (e.clientX - rect.left) / rect.width;
                if (audioRef.current?.duration) seek(p * audioRef.current.duration);
            }}
        >
          <div className="absolute h-full bg-white rounded-full relative transition-all duration-150" style={{ width: `${progress}%` }}>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg scale-0 group-hover:scale-100 transition-transform"></div>
          </div>
        </div>

        <div className="flex justify-between items-center mb-8">
          <button onClick={() => seek(currentTime - 5)} className="text-zinc-500 hover:text-white transition-colors">
            <RotateCcw className="w-6 h-6" />
          </button>
          
          <button 
            onClick={togglePlay} 
            className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-black hover:scale-105 transition-transform"
          >
            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
          </button>
          
          <button onClick={() => seek(currentTime + 5)} className="text-zinc-500 hover:text-white transition-colors">
            <RotateCw className="w-6 h-6" />
          </button>
        </div>

        <button 
            onClick={onNextPhase} 
            className="w-full py-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-semibold text-sm tracking-wide hover:bg-zinc-800 hover:text-white transition-all flex items-center justify-center gap-2"
        >
          <Eye className="w-4 h-4" />
          <span>看原</span>
        </button>
      </div>
    </div>
  );
}
