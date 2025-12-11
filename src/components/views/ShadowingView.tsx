import { X, Mic } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ShadowingViewProps {
  onBack: () => void;
}

export function ShadowingView({ onBack }: ShadowingViewProps) {
  const [isRecording, setIsRecording] = useState(false);

  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* Nav */}
      {/* Nav - flex-col on mobile? No, let's keep row but align properly */}
      <div className="px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6 flex items-center justify-between gap-4">
        <button onClick={onBack} className="p-2 text-zinc-400 hover:text-white">
          <X className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center flex-1">
          <span className="text-xs font-medium text-emerald-500 tracking-widest uppercase">Phase 3</span>
          <span className="text-sm font-semibold text-white tracking-tight">The Mirror</span>
        </div>
        <div className="flex gap-2 bg-zinc-900 rounded-lg p-1">
          <button className="text-[10px] font-bold px-2 py-1 rounded text-zinc-500 hover:text-white">0.8</button>
          <button className="text-[10px] font-bold px-2 py-1 rounded bg-zinc-700 text-white">1.0</button>
          <button className="text-[10px] font-bold px-2 py-1 rounded text-zinc-500 hover:text-white">1.2</button>
        </div>
      </div>

      {/* Waveform Visualizer */}
      <div className="flex-1 flex flex-col justify-center items-center gap-1 px-4">
        {/* Original Audio Track */}
        <div className="w-full h-24 flex items-center justify-center gap-[2px] opacity-80">
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} className="w-1 bg-indigo-400 rounded-full" style={{ height: `${Math.random() * 80 + 10}%` }}></div>
          ))}
        </div>

        {/* Divider */}
        <div className="w-full h-[1px] bg-zinc-800 my-2"></div>

        {/* User Audio Track */}
        <div className={cn("w-full h-24 flex items-center justify-center gap-[2px]", isRecording && "animate-pulse")}>
          {isRecording ? (
            Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="w-1 bg-emerald-400 rounded-full animate-wave" style={{ height: `${Math.random() * 80 + 10}%`, animationDelay: `${i * 0.05}s` }}></div>
            ))
          ) : (
            <span className="text-xs text-zinc-600 font-medium tracking-widest">HOLD TO RECORD</span>
          )}
        </div>
      </div>

      {/* Recorder Control */}
      <div className="p-10 flex flex-col items-center justify-center pb-16">
        <button
          className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all shadow-2xl shadow-red-900/50 flex items-center justify-center relative overflow-hidden"
          onMouseDown={() => setIsRecording(true)}
          onMouseUp={() => setIsRecording(false)}
          onTouchStart={() => setIsRecording(true)}
          onTouchEnd={() => setIsRecording(false)}
        >
          <Mic className="w-8 h-8 text-white relative z-10" />
          <div className={cn("absolute inset-0 bg-red-400 rounded-full transition-transform duration-200", isRecording ? "scale-100 opacity-50" : "scale-0 opacity-0")}></div>
        </button>
        <p className="mt-6 text-xs text-zinc-500 font-medium">让你的语音波形尽量和原文同频</p>
      </div>
    </div>
  );
}
