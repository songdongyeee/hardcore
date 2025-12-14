import { ArrowRight, ChevronLeft, Volume2, X, BookOpen, Eye, EyeOff } from "lucide-react";
import { transcript } from "@/data/transcript";
import { lookupWord, type DictionaryEntry } from "@/data/dictionary";
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

type RecitationMode = 'off' | 'partial' | 'full';

export function AnalysisView({ onBack, onNextPhase, audioRef: _audioRef, currentTime, isPlaying: _isPlaying, seek: _seek }: AnalysisViewProps) {
  const [showEntryHighlight, setShowEntryHighlight] = useState(true);
  const [selectedWordEntry, setSelectedWordEntry] = useState<DictionaryEntry | null>(null);

  // Recitation Mode State
  const [recitationMode, setRecitationMode] = useState<RecitationMode>('off');
  // Store indices to hide for partial mode
  const [hiddenIndices, setHiddenIndices] = useState<Set<string>>(new Set());

  // Disable entry highlight after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowEntryHighlight(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

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

  // Generate hidden indices when entering partial mode
  useEffect(() => {
    if (recitationMode === 'partial') {
      const indices = new Set<string>();
      transcript.forEach((seg, sIdx) => {
        seg.words?.forEach((_, wIdx) => {
          // 70% chance to hide
          if (Math.random() < 0.7) {
            indices.add(`${sIdx}-${wIdx}`);
          }
        });
      });
      setHiddenIndices(indices);
    } else if (recitationMode === 'full') {
      // No need to calc, we just hide all logic in render
    }
  }, [recitationMode]);

  const handleRecitationToggle = () => {
    setRecitationMode(prev => {
      if (prev === 'off') return 'partial';
      if (prev === 'partial') return 'full';
      return 'off';
    });
  };

  const handleWordClick = (word: string) => {
    // 1. Look up word
    const entry = lookupWord(word);

    // 2. If found, show modal. If not, maybe show a toast (omitted for MVP, just no-op or log)
    if (entry) {
      setSelectedWordEntry(entry);
    } else {
      console.warn('Word not in dictionary:', word);
    }
  };

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
        <div className="w-8"></div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 flex items-start justify-center relative" ref={scrollBoxRef}>
        <div className="space-y-6 text-lg md:text-xl font-medium leading-relaxed tracking-tight text-left max-w-md text-zinc-300">
          {transcript.map((seg, idx) => (
            <p key={idx} className="mb-6 leading-loose">
              {seg.words?.map((word, wIdx) => {
                const isWordActive = currentTime >= word.start && currentTime < word.end;
                // If active, attach ref (only if we haven't scrolled yet technically, but keeping it simple)
                const refProps = isWordActive && !hasScrolledRef.current ? { ref: activeWordRef } : {};

                const isSelected = selectedWordEntry?.word.toLowerCase() === word.text.toLowerCase().replace(/[^a-z]/g, "");

                // Recitation Logic
                let isHidden = false;
                if (recitationMode === 'full') isHidden = true;
                else if (recitationMode === 'partial' && hiddenIndices.has(`${idx}-${wIdx}`)) isHidden = true;

                // Active word always visible? Or also hidden? 
                // Usually active word should be visible to follow along, OR hidden to test memory?
                // Request says "randomly dug out", "all dug out". Use intuition: hidden is hidden.
                // But maybe if user clicks it, it reveals? (Dictionary handles click)

                return (
                  <span key={wIdx} className="inline-block mr-1.5 relative group">
                    <span
                      {...refProps}
                      onClick={(e) => {
                        e.stopPropagation();
                        // If hidden and clicked, maybe reveal it? Or just show dictionary?
                        // Let's assume lookup still works even if hidden (user might want to peek/check).
                        handleWordClick(word.text);
                      }}
                      className={cn(
                        "transition-all duration-300 cursor-pointer px-0.5 rounded border-b border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900",
                        // Active Highlighter Logic (Keep 3s fade out or persistent active state)
                        isWordActive && showEntryHighlight && "bg-indigo-500/80 text-white shadow-lg shadow-indigo-500/20",
                        isWordActive && !showEntryHighlight && "text-indigo-400",
                        // Selected (Dictionary) Logic
                        isSelected && "bg-white text-black border-transparent",
                        // Recitation / Hidden Logic
                        isHidden && !isWordActive && "bg-zinc-800 text-transparent select-none border-transparent",
                        // If active is hidden?? Maybe let active word shine through if needed, 
                        // BUT usually recitation means you have to guess it.
                        // Let's make hidden override everything except maybe selection?
                        // If I select it (click it), I want to see it? Dictionary modal shows it.
                        // Let's keep it hidden in text flow.
                        isHidden && isWordActive && "bg-indigo-500/50 text-transparent"
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
      <div className="p-6 bg-black border-t border-zinc-900 shrink-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex gap-4">
        {/* Recitation Toggle Button */}
        <button
          onClick={handleRecitationToggle}
          className={cn(
            "flex-1 p-4 rounded-xl font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 border",
            recitationMode === 'off'
              ? "bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-white"
              : "bg-indigo-500/20 text-indigo-300 border-indigo-500/50"
          )}
        >
          {recitationMode === 'off' && <BookOpen className="w-5 h-5" />}
          {recitationMode === 'partial' && <Eye className="w-5 h-5" />}
          {recitationMode === 'full' && <EyeOff className="w-5 h-5" />}

          <span>
            {recitationMode === 'off' && "背诵模式"}
            {recitationMode === 'partial' && "70%"}
            {recitationMode === 'full' && "100%"}
          </span>
        </button>

        {/* Primary Action */}
        <button
          onClick={onNextPhase}
          className="w-[35%] py-4 rounded-xl bg-white text-black font-semibold text-sm tracking-wide hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5"
        >
          <span>开始录</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Dictionary Modal */}
      {selectedWordEntry && (
        <>
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
            onClick={() => setSelectedWordEntry(null)}
          ></div>
          <div className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-6 z-50 pb-[calc(2rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-3xl font-bold text-white mb-1">{selectedWordEntry.word}</h3>
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="font-mono text-sm">{selectedWordEntry.phonetic}</span>
                  <button className="p-1 rounded-full bg-zinc-800 hover:bg-zinc-700">
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => setSelectedWordEntry(null)}
                className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {selectedWordEntry.meanings.map((meaning, i) => (
                <div key={i}>
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider bg-indigo-500/10 px-2 py-0.5 rounded">{meaning.partOfSpeech}</span>
                  <ul className="mt-2 space-y-2">
                    {meaning.definitions.map((def, j) => (
                      <li key={j} className="text-zinc-300 text-base leading-relaxed">
                        • {def}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
