import { ArrowRight, ChevronLeft, ToggleRight } from "lucide-react";
import { transcript } from "@/data/transcript";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface AnalysisViewProps {
  onBack: () => void;
  onNextPhase: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  isPlaying: boolean;
  seek: (time: number) => void;
}

export function AnalysisView({ onBack, onNextPhase, audioRef, currentTime, isPlaying, seek }: AnalysisViewProps) {
  const [clozeLevel, setClozeLevel] = useState(0);
  const [showEntryHighlight, setShowEntryHighlight] = useState(true);

  // Disable entry highlight after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowEntryHighlight(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const toggleCloze = () => {
    setClozeLevel((prev) => (prev + 1) % 3);
  };

  const isClozeWord = (word: string) => {
    // Simple heuristic for demo
    return word.length > 3 && Math.random() > 0.4;
  };

  // Initial Scroll Logic
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    // Only scroll once on mount/entry
    if (activeWordRef.current && scrollBoxRef.current && !hasScrolledRef.current) {
      const element = activeWordRef.current;
      element.scrollIntoView({ behavior: 'auto', block: 'center' });
      hasScrolledRef.current = true;
    }
  }, []); // Run once on mount

  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* Nav */}
      <div className="px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6 flex justify-between items-center border-b border-zinc-900 bg-black/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-medium text-zinc-500 tracking-widest uppercase">Phase 2</span>
          <span className="text-sm font-semibold text-white tracking-tight">The Lab</span>
        </div>
        <button onClick={toggleCloze} className="p-2 -mr-2 mt-2 text-zinc-400 hover:text-indigo-400 transition-colors relative">
          <ToggleRight className={cn("w-6 h-6", clozeLevel > 0 && "text-indigo-500")} />
          {clozeLevel > 0 && <span className="absolute top-1 right-0 w-2 h-2 bg-indigo-500 rounded-full"></span>}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 flex items-start justify-center relative" ref={scrollBoxRef}>
        <div className="space-y-6 text-lg md:text-xl font-medium leading-relaxed tracking-tight text-left max-w-md text-zinc-300">
          {transcript.map((seg, idx) => (
            <p key={idx} className="mb-6 leading-loose">
              {seg.words?.map((word, wIdx) => {
                const isWordActive = currentTime >= word.start && currentTime < word.end;
                const isCloze = isClozeWord(word.text);
                const isHidden = clozeLevel === 2 || (clozeLevel === 1 && isCloze);

                // If active, attach ref
                const refProps = isWordActive ? { ref: activeWordRef } : {};

                return (
                  <span key={wIdx} className="inline-block mr-1.5 relative group">
                    <span
                      {...refProps}
                      onClick={() => seek(word.start)}
                      className={cn(
                        "transition-all duration-300 cursor-pointer px-0.5 rounded border-b border-transparent",
                        isHidden
                          ? "bg-zinc-800 text-transparent border-zinc-600 rounded-sm select-none"
                          : "hover:text-white",
                        // Active Logic
                        isWordActive && showEntryHighlight && "bg-indigo-500/80 text-white shadow-lg shadow-indigo-500/20",
                        isWordActive && !showEntryHighlight && "text-indigo-400"
                      )}
                    >
                      {word.text}
                    </span>
                  </span>
                );
              }) || seg.text}
            </p>
          ))}
        </div>
      </div>

      {/* Footer Action */}
      <div className="p-6 bg-black border-t border-zinc-900 shrink-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <button
          onClick={onNextPhase}
          className="w-full py-4 rounded-xl bg-white text-black font-semibold text-sm tracking-wide hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5"
        >
          <span>开始录</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
