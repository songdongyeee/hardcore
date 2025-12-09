import { ArrowRight, ChevronLeft, ToggleRight } from "lucide-react";
import { transcript } from "@/data/transcript";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface AnalysisViewProps {
  onBack: () => void;
  onNextPhase: () => void;
}

export function AnalysisView({ onBack, onNextPhase }: AnalysisViewProps) {
  const [clozeLevel, setClozeLevel] = useState(0);

  const toggleCloze = () => {
    setClozeLevel((prev) => (prev + 1) % 3);
  };

  const isClozeWord = (word: string) => {
     // Simple heuristic for demo
     return word.length > 3 && Math.random() > 0.4;
  };

  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* Nav */}
      <div className="px-6 py-6 flex justify-between items-center border-b border-zinc-900 bg-black/90 backdrop-blur-md sticky top-0 z-10">
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
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="text-lg leading-loose font-normal text-zinc-300 tracking-tight">
            {transcript.map((seg, idx) => (
                <p key={idx} className="mb-6">
                    {seg.text.split(" ").map((word, wIdx) => {
                        const cleanWord = word.replace(/[^\w']/g, '');
                        const isTarget = isClozeWord(cleanWord);
                        const isHidden = clozeLevel === 2 || (clozeLevel === 1 && isTarget);
                        
                        return (
                           <span key={wIdx} className="inline-block mr-1.5 group relative">
                                <span 
                                    className={cn(
                                        "transition-all duration-200 cursor-pointer border-b border-transparent",
                                        isHidden ? "bg-zinc-800 text-transparent border-zinc-600 rounded-sm select-none" : "hover:text-white"
                                    )}
                                >
                                    {word}
                                </span>
                           </span> 
                        );
                    })}
                </p>
            ))}
        </div>
      </div>

      {/* Footer Action */}
      <div className="p-6 bg-black border-t border-zinc-900">
         <button 
            onClick={onNextPhase} 
            className="w-full py-4 rounded-xl bg-white text-black font-semibold text-sm tracking-wide hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5"
        >
            <span>开始录音</span>
            <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
