import { useEffect, useRef } from "react";
import { Play, Tag } from "lucide-react";
import "./SentencePopover.css";

interface SentencePopoverProps {
  x: number;
  y: number;
  sentenceIdx: number;
  wordIdx?: number;
  isMarked: boolean;
  onPlay: (idx: number) => void;
  onToggleMark: (sentenceIdx: number, wordIdx?: number, isMarking?: boolean) => void;
  onClose: () => void;
}

export function SentencePopover({
  x, y, sentenceIdx, wordIdx, isMarked, onPlay, onToggleMark, onClose
}: SentencePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      // Allow slight delay before closing to register fast touches
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture phase to ensure it handles before other specific events
    document.addEventListener("mousedown", handleClickOutside, { capture: true });
    document.addEventListener("touchstart", handleClickOutside, { capture: true });
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, { capture: true });
      document.removeEventListener("touchstart", handleClickOutside, { capture: true });
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="sentence-popover fixed z-50 flex items-center gap-1 p-1.5 bg-zinc-800/95 backdrop-blur-md rounded-2xl border border-zinc-700/50 shadow-2xl"
      style={{
        left: Math.min(x, window.innerWidth - 180),
        top: Math.max(20, y - 60)
      }}
      onClick={(e) => e.stopPropagation()} // exact propagation stop
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlay(sentenceIdx);
          onClose();
        }}
        className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-xl transition-colors text-white active:scale-95"
      >
        <Play size={16} className="fill-white" />
        <span className="text-sm font-medium">播放</span>
      </button>
      
      <div className="w-[1px] h-6 bg-zinc-700 mx-1" />
      
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleMark(sentenceIdx, wordIdx, !isMarked);
          onClose();
        }}
        className={`flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-xl transition-colors active:scale-95 ${
          isMarked ? 'text-amber-400' : 'text-zinc-300 hover:text-white'
        }`}
      >
        <Tag size={16} className={isMarked ? 'fill-amber-400' : ''} />
        <span className="text-sm font-medium">{isMarked ? '取消标记' : '标记生词'}</span>
      </button>
    </div>
  );
}
