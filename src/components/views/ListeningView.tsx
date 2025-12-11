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

  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);

  // Calculate percentage for display (prioritize drag value if dragging)
  const currentProgress = audioRef.current?.duration
    ? (currentTime / audioRef.current.duration) * 100
    : 0;
  const displayProgress = isDragging ? dragProgress : currentProgress;

  const handleSeekInteraction = (e: React.PointerEvent<HTMLDivElement>, isFinal: boolean = false) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));

    if (isFinal) {
      if (audioRef.current?.duration) seek(percentage * audioRef.current.duration);
      setIsDragging(false);
    } else {
      setDragProgress(percentage * 100);
    }
  };

  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* Nav */}
      <div className="px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6 flex justify-between items-center border-b border-zinc-900 bg-black shrink-0">
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
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 flex items-start justify-center relative" ref={scrollBoxRef}>
        <div ref={containerRef} className="space-y-6 text-lg md:text-xl font-medium leading-relaxed tracking-tight text-left max-w-md">
          {transcript.map((seg, idx) => (
            <p key={idx} className="mb-6 leading-loose" onClick={() => seek(seg.start)}>
              {seg.words?.map((word, wIdx) => {
                // Check if this word is currently active
                const isWordActive = currentTime >= word.start && currentTime < word.end;

                return (
                  <span
                    key={wIdx}
                    className={cn(
                      "inline-block mr-1.5 px-0.5 rounded transition-all duration-100",
                      isWordActive
                        ? "filter blur-[4px] bg-indigo-500/50 text-white"
                        : "filter blur-[8px] text-zinc-400"
                    )}
                  >
                    {word.text}
                  </span>
                );
              }) || (
                  // Fallback if no words (shouldn't happen with new data)
                  <span className="blur-[8px] text-zinc-400">{seg.text}</span>
                )}
            </p>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="p-8 pb-[calc(2.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-black to-transparent shrink-0">
        {/* Scrubber */}
        <div
          className="w-full h-8 flex items-center mb-6 relative group cursor-pointer touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setIsDragging(true);
            handleSeekInteraction(e);
          }}
          onPointerMove={(e) => {
            if (isDragging) handleSeekInteraction(e);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            handleSeekInteraction(e, true);
          }}
          onPointerCancel={(e) => {
            setIsDragging(false);
          }}
        >
          {/* Track */}
          <div className="w-full h-1 bg-zinc-800 rounded-full relative overflow-hidden">
            {/* Progress Bar */}
            <div
              className="col-span-1 h-full bg-white rounded-full relative"
              style={{ width: `${displayProgress}%`, transition: isDragging ? 'none' : 'width 0.1s linear' }}
            ></div>
          </div>

          {/* Thumb (Always visible for clarity on mobile, or group-hover if preferred, but dragging needs visibility) */}
          <div
            className="absolute h-4 w-4 bg-white rounded-full shadow-lg top-1/2 -translate-y-1/2 -ml-2 pointer-events-none transition-transform duration-100 ease-out"
            style={{ left: `${displayProgress}%`, transform: isDragging ? 'translateY(-50%) scale(1.2)' : 'translateY(-50%) scale(1)' }}
          ></div>
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
