import React, { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { Eye, RotateCcw, RotateCw, Pause, Play, ChevronLeft, Info, Repeat, Bookmark, BookmarkX, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TranscriptSegment } from "@/data/transcript";
import type { MarkedWord } from "@/App";
import { TranscriptSkeleton, WaveformSkeleton } from "../ui/Skeletons";
import { StepGuideModal } from "../ui/StepGuideModal";

interface ListeningViewProps {
  onBack: () => void;
  onNextPhase: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (time: number) => void;
  transcript: TranscriptSegment[];
  waveformData?: number[][];
  coverUrl?: string;
  // 🔖 单词标记功能
  markedWords: MarkedWord[];
  onMarkWord: (word: { id: string; text: string; segmentIndex: number; wordIndex: number }) => void;
  onUnmarkWord: (wordId: string) => void;
}

interface SentenceRowProps {
  seg: any;
  idx: number;
  isCurrentSentence: boolean;
  isSelected: boolean;
  markedWordMap: Map<string, MarkedWord>;
  isLoopMode: boolean; // 🔖 新增：控制是否显示复选框
  clickedWordId?: string; // 🔖 新增：用于跟踪点选高亮的单词
  onSentenceClick: (idx: number, start: number) => void;
  onWordClick: (e: React.MouseEvent, segIdx: number, wordIdx: number, wordText: string) => void;
  currentTime: number; // 🎯 新增：父组件仅将当前时间传给当前活跃的句子
}

const SentenceRow = memo(({
  seg,
  idx,
  isCurrentSentence,
  isSelected,
  markedWordMap,
  isLoopMode,
  clickedWordId,
  onSentenceClick,
  onWordClick,
  currentTime
}: SentenceRowProps) => {
  // 🎯 PERFORMANCE: Inactive sentences receive 0 for currentTime, so their props don't change and React.memo prevents re-rendering.
  // This completely safely achieves the original intent without having buggy event listeners and stale refs!

  return (
    <div
      className={cn(
        "mb-10 relative flex items-start gap-4 transition-all duration-300 rounded-xl p-3 -mx-3",
        isSelected ? "bg-zinc-800/50 ring-1 ring-zinc-700 z-40 shadow-xl" : "hover:bg-zinc-900/30",
        isLoopMode ? "cursor-default" : "cursor-pointer"
      )}
      onClick={!isLoopMode ? () => onSentenceClick(idx, seg.start) : undefined}
    >
      <p className="flex-1 leading-loose relative">
        {/* 🎯 用最快的 text-shadow 实现全篇全局模糊，抛弃卡顿的 filter: blur */}
        <span>
          {(() => {
            const wordList = seg.words?.map((word: any, wIdx: number) => ({
              text: word.text,
              start: word.start,
              end: word.end,
              wordIndex: wIdx,
            })) || [];

            if (wordList.length === 0) {
              return (
                <span style={{ color: 'transparent', textShadow: isSelected ? '0 0 8px rgba(212,212,216,0.9)' : '0 0 8px rgba(161,161,170,0.9)' }}>
                  {seg.text}
                </span>
              );
            }

            return wordList.map((chunk: any, cIdx: number) => {
              let isChunkActive = false;
              // 只有当前活动句里的词才参与耗时的卡拉OK时间对比
              if (isCurrentSentence) {
                const TOLERANCE = 0.1;
                isChunkActive = currentTime >= (chunk.start - TOLERANCE) && currentTime < (chunk.end + TOLERANCE);
              }

              const wordId = `${idx}-${chunk.wordIndex}`;
              const markedEntry = markedWordMap.get(wordId);
              const isMarked = !!markedEntry;
              const isClicked = clickedWordId === wordId;

              // 根据状态赋予极简 blur style（text-shadow性能极高）
              let wordStyle: React.CSSProperties = { color: 'transparent' };
              if (isChunkActive) {
                wordStyle.textShadow = '0 0 8px rgba(255, 255, 255, 0.9)'; // 活跃词：亮白色但依然模糊
              } else if (isMarked) {
                wordStyle.textShadow = '0 0 8px rgba(245, 158, 11, 0.7)';
              } else if (isSelected) {
                wordStyle.textShadow = '0 0 8px rgba(212, 212, 216, 0.9)';
              } else {
                wordStyle.textShadow = '0 0 8px rgba(161, 161, 170, 0.9)';
              }

              return (
                <span
                  key={cIdx}
                  className={cn(
                    "inline-block mr-1.5 relative group cursor-pointer transition-colors duration-150",
                    isClicked ? "ring-1 ring-zinc-500 rounded px-0.5 bg-zinc-800/80 z-20" : ""
                  )}
                  style={wordStyle}
                  onClick={(e) => onWordClick(e, idx, chunk.wordIndex, chunk.text)}
                >
                  {/* 仅针对当前正读的活跃词加上闪亮背景，但同样模糊处理 */}
                  {isChunkActive && (
                    <span
                      className="absolute inset-0 -inset-x-0.5 bg-gradient-to-r from-indigo-500/60 to-indigo-600/60 rounded opacity-100 scale-100 transition-all duration-150 ease-out z-0 blur-[3px]"
                    />
                  )}
                  {/* 生词底色标志 */}
                  {(isMarked && !isChunkActive && !isClicked) && (
                    <span className="absolute inset-0 -inset-x-0.5 bg-amber-500/10 rounded z-0" />
                  )}

                  <span className="relative z-10">{chunk.text}</span>

                  {/* 生词角标 */}
                  {isMarked && markedEntry && (
                    <span className={cn(
                      "absolute -top-2 -right-1 min-w-[16px] h-[16px] text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 z-20 shadow",
                      isChunkActive || isClicked ? "bg-amber-500 text-black" : "bg-amber-500/50 text-black/50"
                    )}>
                      {markedEntry.order}
                    </span>
                  )}
                </span>
              );
            });
          })()}
        </span>
      </p>

      {/* 右侧复选框 (仅在选句循环模式下显示) */}
      {isLoopMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSentenceClick(idx, seg.start);
          }}
          className={cn(
            "shrink-0 w-5 h-5 rounded-[6px] border-[1.5px] flex items-center justify-center transition-all mt-1.5 cursor-pointer relative",
            isSelected
              ? "bg-indigo-500 border-indigo-500 shadow-sm shadow-indigo-500/20 scale-105"
              : "border-zinc-600 hover:border-zinc-500 bg-zinc-900/20"
          )}
        >
          {/* 增加一个隐形的扩大点击区域 */}
          <span className="absolute -inset-2"></span>
          {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
      )}
    </div>
  );
});

// 🔖 Popover 锚点状态
interface PopoverState {
  wordId: string;
  wordText: string;
  segmentIndex: number;
  wordIndex: number;
  x: number;
  y: number;
}

export function ListeningView({
  onBack,
  onNextPhase,
  audioRef,
  currentTime,
  isPlaying,
  togglePlay,
  seek,
  transcript,
  waveformData,
  coverUrl,
  markedWords,
  onMarkWord,
  onUnmarkWord,
}: ListeningViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  // 🔖 单词 Popover 状态
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // 🔖 构建 markedWords 快查 Map：wordId -> MarkedWord
  const markedWordMap = useMemo(() => {
    const map = new Map<string, MarkedWord>();
    markedWords.forEach(w => map.set(w.id, w));
    return map;
  }, [markedWords]);

  // 🔖 点击单词时弹出 Popover（阻止事件冒泡到句子的 seek 事件）
  const handleWordClick = useCallback((e: React.MouseEvent, segIdx: number, wordIdx: number, wordText: string) => {
    e.stopPropagation();
    const wordId = `${segIdx}-${wordIdx}`;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ wordId, wordText, segmentIndex: segIdx, wordIndex: wordIdx, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  // 关闭 Popover
  const closePopover = useCallback(() => setPopover(null), []);

  // 🚀 OPTIMIZATION: Memoize normalizedTranscript to avoid recalculating on every render
  const normalizedTranscript = useMemo(() => {
    return transcript.map(seg => {
      if (seg.words && seg.words.length > 0) {
        return seg; // Already has words
      }

      // Generate mock words
      const rawWords = seg.text.split(' ');
      const duration = seg.end - seg.start;
      const wordDuration = duration / Math.max(rawWords.length, 1);

      const words = rawWords.map((word, i) => ({
        text: word,
        start: seg.start + (i * wordDuration),
        end: seg.start + ((i + 1) * wordDuration)
      }));

      return { ...seg, words };
    });
  }, [transcript]);

  // 🚀 PERFORMANCE: Use binary search to find active sentence using currentTime
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(-1);
  const activeSentenceIndexRef = useRef(-1);

  useEffect(() => {
    if (normalizedTranscript.length === 0) return;

    let left = 0;
    let right = normalizedTranscript.length - 1;
    let newIdx = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const seg = normalizedTranscript[mid];
      if (currentTime >= seg.start && currentTime <= seg.end) {
        newIdx = mid;
        break;
      } else if (currentTime < seg.start) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    if (newIdx !== activeSentenceIndexRef.current) {
      activeSentenceIndexRef.current = newIdx;
      setActiveSentenceIndex(newIdx); // ✅ Only triggers React re-render on sentence change
    }
  }, [currentTime, normalizedTranscript]);

  // Sync active segment and scroll - only fires when activeSentenceIndex changes
  useEffect(() => {
    if (activeSentenceIndex !== -1 && containerRef.current && scrollBoxRef.current) {
      const activeEl = containerRef.current.children[activeSentenceIndex] as HTMLElement;
      if (activeEl) {
        const rect = activeEl.getBoundingClientRect();
        const boxRect = scrollBoxRef.current.getBoundingClientRect();
        if (rect.top < boxRect.top + boxRect.height * 0.3 || rect.bottom > boxRect.top + boxRect.height * 0.7) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [activeSentenceIndex]);

  // --- Loop Mode Logic ---
  const [isLoopMode, setIsLoopMode] = useState(false);
  const [selectedSentences, setSelectedSentences] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isLoopMode && selectedSentences.size === 0 && activeSentenceIndex !== -1) {
      setSelectedSentences(new Set([activeSentenceIndex]));
    }
    if (!isLoopMode) {
      setSelectedSentences(new Set());
    }
  }, [isLoopMode, activeSentenceIndex]);

  useEffect(() => {
    if (!isLoopMode || selectedSentences.size === 0) return;

    const indices = Array.from(selectedSentences).sort((a, b) => a - b);
    if (indices.length === 0) return;
    const startTime = normalizedTranscript[indices[0]].start;
    const endTime = normalizedTranscript[indices[indices.length - 1]].end;

    if (currentTime >= endTime) {
      seek(startTime);
    }
  }, [currentTime, isLoopMode, selectedSentences, normalizedTranscript, seek]);

  const toggleLoopMode = () => {
    setIsLoopMode(prev => !prev);
  };

  const isLoopModeRef = useRef(isLoopMode);
  useEffect(() => {
    isLoopModeRef.current = isLoopMode;
  }, [isLoopMode]);

  const seekRef = useRef(seek);
  useEffect(() => {
    seekRef.current = seek;
  }, [seek]);

  const handleSentenceClick = useCallback((idx: number, start: number) => {
    if (isLoopModeRef.current) {
      setSelectedSentences(prev => {
        const next = new Set(prev);
        if (next.has(idx)) {
          next.delete(idx);
        } else {
          next.add(idx);
        }
        return next;
      });
    } else {
      seekRef.current?.(start);
    }
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [showTip, setShowTip] = useState(false);

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
    <>
      <div className="absolute inset-0 bg-black z-30 flex flex-col h-full w-full">
        {/* Nav */}
        <div className="px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-4 flex justify-between items-center border-b border-zinc-900 bg-black/90 backdrop-blur-md sticky top-0 z-40 shrink-0">
          {/* 左侧：返回 */}
          <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white transition-colors">
            <ChevronLeft size={24} />
          </button>

          {/* 中间：引导按钮 */}
          <StepGuideModal
            stepKey="listening"
            title="第一步：通篇盲听"
            description={
              <div className="flex flex-col gap-3 text-left">
                <p>听长难句或生词时，<strong>尽量不要停下来</strong>，试着掌握段落的整体意思。</p>
                <p>在听的过程中，点击你不理解的生词进行<strong>【标记】</strong>。推荐这步配合纸笔：好记性不如烂笔头。</p>
              </div>
            }
          />
          <div className="relative">
            <button
              onClick={() => setShowTip(!showTip)}
              className="p-2 -mr-2 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Info className="w-4 h-4" />
            </button>
            {showTip && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 rounded-lg p-3 shadow-xl animate-in fade-in slide-in-from-top-2 z-50">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  阿里云转写服务可能会出现时间与单词不对应的情况
                </p>
                <div className="absolute -top-1 right-3 w-2 h-2 bg-zinc-900 border-l border-t border-zinc-700 rotate-45"></div>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 flex items-start justify-center relative no-scrollbar" ref={scrollBoxRef}>
          {/* Anti-Lint */}
          <div className="hidden">{coverUrl}{waveformData?.length}</div>

          {normalizedTranscript.length === 0 ? (
            <div className="text-center text-zinc-500 mt-20 w-full max-w-xl">
              <TranscriptSkeleton />
              {waveformData === undefined && <div className="mt-8 h-12 w-full"><WaveformSkeleton /></div>}
            </div>
          ) : (
            <div ref={containerRef} className="space-y-10 text-xl md:text-2xl font-sans font-medium leading-relaxed tracking-wide text-left max-w-xl pb-20">
              {normalizedTranscript.map((seg, idx) => {
                const isCurrentSentence = idx === activeSentenceIndex;
                const isSelected = isLoopMode && selectedSentences.has(idx);

                return (
                  <SentenceRow
                    key={idx}
                    seg={seg}
                    idx={idx}
                    isCurrentSentence={isCurrentSentence}
                    isSelected={isSelected}
                    markedWordMap={markedWordMap}
                    isLoopMode={isLoopMode}
                    clickedWordId={popover?.wordId}
                    onSentenceClick={handleSentenceClick}
                    onWordClick={handleWordClick}
                    currentTime={activeSentenceIndex === idx ? currentTime : 0}
                  />
                );
              })}
            </div>
          )}

        </div>

        {/* Controls */}
        <div className="p-6 pb-[calc(2rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-black to-transparent shrink-0">
          <div className="max-w-2xl mx-auto">
            {/* Scrubber & Time */}
            <div className="flex items-center gap-3 mb-8 w-full">
              <span className="text-xs font-medium text-zinc-500 w-10 text-right tabular-nums">
                {(() => {
                  const cur = isDragging
                    ? ((audioRef.current?.duration || 0) * (dragProgress / 100))
                    : currentTime;
                  const m = Math.floor(cur / 60);
                  const s = Math.floor(cur % 60);
                  return `${m}:${s.toString().padStart(2, '0')}`;
                })()}
              </span>

              <div
                className="flex-1 h-8 flex items-center relative group cursor-pointer touch-none"
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
                onPointerCancel={() => {
                  setIsDragging(false);
                }}
              >
                <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${displayProgress}%`, transition: isDragging ? 'none' : 'width 0.1s linear' }}
                  ></div>
                </div>

                <div
                  className="absolute w-4 h-4 bg-white rounded-full shadow-lg"
                  style={{ left: `${displayProgress}%`, transform: isDragging ? 'translateX(-50%) scale(1.2)' : 'translateX(-50%)' }}
                ></div>
              </div>

              <span className="text-xs font-medium text-zinc-500 w-10 text-left tabular-nums">
                {(() => {
                  const dur = audioRef.current?.duration || 0;
                  const m = Math.floor(dur / 60);
                  const s = Math.floor(dur % 60);
                  return `${m}:${s.toString().padStart(2, '0')}`;
                })()}
              </span>
            </div>

            {/* Play Controls */}
            <div className="flex items-center justify-center gap-8 mb-6 relative">
              <button
                onClick={toggleLoopMode}
                className={cn(
                  "p-2 rounded-xl transition-all flex flex-col items-center gap-1.5 min-w-[64px]",
                  isLoopMode || selectedSentences.size > 0 ? "text-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-500/30" : "text-zinc-300 hover:text-white"
                )}
              >
                <div className="relative">
                  <Repeat className="w-5 h-5" />
                  {(isLoopMode || selectedSentences.size > 0) && (
                    <span className="absolute -top-1.5 -right-2 text-[10px] bg-indigo-500 text-white min-w-[16px] h-[16px] rounded-full font-bold flex items-center justify-center px-1 shadow-sm">
                      {selectedSentences.size || 0}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium tracking-tight">选句循环</span>
              </button>

              <div className="flex items-center gap-6">
                <button onClick={() => seek(currentTime - 5)} className="p-3 text-zinc-400 hover:text-white transition-colors">
                  <RotateCcw className="w-6 h-6" />
                </button>

                <button onClick={togglePlay} className="p-5 bg-white rounded-full text-black hover:bg-zinc-200 transition-all scale-110 shadow-lg shadow-white/10">
                  {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
                </button>

                <button onClick={() => seek(currentTime + 5)} className="p-3 text-zinc-400 hover:text-white transition-colors">
                  <RotateCw className="w-6 h-6" />
                </button>
              </div>

              {/* Spacer */}
              <div className="w-9"></div>
            </div>

            {/* Next Phase Button */}
            <button
              onClick={onNextPhase}
              className="w-full py-4 rounded-2xl bg-zinc-800 text-zinc-300 font-normal text-sm border border-zinc-700 hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
            >
              <Eye className="w-5 h-5" />
              <span>下一步 看原文</span>
            </button>
          </div>
        </div>
      </div>

      {/* 🔖 单词标记 Popover 浮层 */}
      {popover && (() => {
        const p = popover;
        return (
          <>
            {/* 背景遮罩：点击关闭 */}
            <div className="fixed inset-0 z-[99]" onClick={closePopover} />
            {/* Popover 卡片 */}
            <div
              className="fixed z-[100] animate-in fade-in zoom-in-95 duration-150"
              style={{
                left: `${p.x}px`,
                top: `${p.y - 8}px`,
                transform: 'translateX(-50%) translateY(-100%)'
              }}
            >
              <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl shadow-black/60 backdrop-blur-xl overflow-hidden min-w-[130px]">
                {/* 操作按钮 */}
                {markedWordMap.has(p.wordId) ? (
                  <button
                    onClick={() => { onUnmarkWord(p.wordId); closePopover(); }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-red-400 hover:bg-red-500/10 transition-colors active:scale-95"
                  >
                    <BookmarkX size={16} />
                    <span className="text-sm font-medium">取消标记</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { onMarkWord({ id: p.wordId, text: p.wordText, segmentIndex: p.segmentIndex, wordIndex: p.wordIndex }); closePopover(); }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-amber-400 hover:bg-amber-500/10 transition-colors active:scale-95"
                  >
                    <Bookmark size={16} />
                    <span className="text-sm font-medium">标记生词</span>
                  </button>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
