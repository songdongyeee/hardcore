import type { TranscriptSegment } from "@/data/transcript";
import { lookupWord, type DictionaryEntry } from "@/data/dictionary";
import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import type { MarkedWord } from "@/App";
import { lookupOnlineDictionary } from "@/lib/onlineDictionary";
import { ArrowRight, ChevronLeft, Volume2, X, Eye, EyeOff, Play, Pause, Bookmark, BookmarkX, ListChecks, Loader2, Sparkles } from "lucide-react";
import { StepGuideModal } from "../ui/StepGuideModal";
import { VocabularySheet, type VocabularyItem } from "../VocabularySheet";
import { MnemonicSheet } from "@/components/views/MnemonicSheet";

interface AnalysisViewProps {
  onBack: () => void;
  onNextPhase: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  isPlaying: boolean;
  seek: (time: number) => void;
  transcript: TranscriptSegment[];
  markedWords: MarkedWord[];
  onMarkWord: (word: { id: string; text: string; segmentIndex: number; wordIndex: number }) => void;
  onUnmarkWord: (wordId: string) => void;
  materialTitle?: string;
}

type RecitationMode = 'off' | 'partial' | 'full';

// --- Extracted Memoized ParagraphRow ---
interface ParagraphRowProps {
  seg: TranscriptSegment;
  idx: number;
  currentTime: number;
  isPlaying: boolean;
  recitationMode: RecitationMode;
  hiddenIndices: Set<string>;
  markedWordMap: Map<string, MarkedWord>;
  selectedWordId?: string;
  showEntryHighlight: boolean;
  hasScrolledRefFocus: boolean;
  activeWordRef: React.Ref<HTMLSpanElement>;
  showTranslation: boolean;
  handleSegmentPlay: (e: React.MouseEvent, start: number, end: number) => void;
  handleWordClick: (wordText: string, sentenceIdx: number, wordIdx: number) => void;
  togglePlay: () => void;
}

const ParagraphRow = memo(({
  seg,
  idx,
  currentTime,
  isPlaying,
  recitationMode,
  hiddenIndices,
  markedWordMap,
  selectedWordId,
  showEntryHighlight,
  hasScrolledRefFocus,
  activeWordRef,
  showTranslation,
  handleSegmentPlay,
  handleWordClick,
  togglePlay
}: ParagraphRowProps) => {
  const isPlayingThisSeg = isPlaying && currentTime >= seg.start && currentTime < seg.end;

  return (
    <div className="mb-10 relative group/segment">
      <div data-segment-index={idx} className="absolute -top-8" />
      {/* 🎵 段落独立播放按钮 */}
      <div className="mb-4">
        <button
          onClick={(e) => {
            if (isPlayingThisSeg) {
              togglePlay();
            } else {
              handleSegmentPlay(e, seg.start, seg.end);
            }
          }}
          className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wider transition-all active:scale-95 border",
            isPlayingThisSeg
              ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
              : "bg-zinc-800/50 text-zinc-400 border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-300"
          )}
          title="播放此段"
        >
          {isPlayingThisSeg ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
          <span>{isPlayingThisSeg ? '暂停' : '播放'}</span>
        </button>
      </div>

      <p className="leading-loose transition-all duration-300">
        {seg.words?.map((word, wIdx) => {
          const isWordActive = currentTime >= word.start && currentTime < word.end;
          const isRecentWord = currentTime >= word.end && currentTime < word.end + 2;
          const shouldHighlight = isWordActive || (isRecentWord && !hasScrolledRefFocus);
          const refProps = shouldHighlight && !hasScrolledRefFocus ? { ref: activeWordRef } : {};

          const isSelected = selectedWordId === `${idx}-${wIdx}`;

          // 🔖 标记词检查
          const wordId = `${idx}-${wIdx}`;
          const markedEntry = markedWordMap.get(wordId);
          const isMarked = !!markedEntry;

          let isHidden = false;
          const isRealWord = /\p{L}|\p{N}/u.test(word.text);
          if (isRealWord) {
            if (recitationMode === 'full') isHidden = true;
            else if (recitationMode === 'partial' && hiddenIndices.has(`${idx}-${wIdx}`)) isHidden = true;
          }

          return (
            <span key={wIdx} className="inline-block mr-1.5 relative group">
              {/* 🔖 标记词底色 */}
              {isMarked && !isWordActive && !isHidden && (
                <span className="absolute inset-0 -inset-x-0.5 bg-amber-500/20 rounded z-0" />
              )}
              <span
                {...refProps}
                onClick={(e) => {
                  e.stopPropagation();
                  handleWordClick(word.text, idx, wIdx);
                }}
                className={cn(
                  "relative z-10 transition-all duration-200 cursor-pointer rounded-md border-b border-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800",
                  isWordActive && showEntryHighlight && "bg-indigo-500/80 text-white shadow-lg shadow-indigo-500/20",
                  isWordActive && !showEntryHighlight && "text-indigo-400",
                  isSelected && "text-amber-400 bg-amber-500/20 border-amber-500/50",
                  isMarked && !isWordActive && !isSelected && "text-amber-300",
                  isHidden && !isWordActive && "bg-zinc-800 text-transparent select-none rounded-md",
                  isHidden && isWordActive && "bg-indigo-500 text-transparent rounded-md animate-pulse"
                )}
              >
                {word.text}
              </span>

              {/* 🔢 已标记序号角标 */}
              {isMarked && markedEntry && (
                <span className="absolute -top-2 -right-1 min-w-[16px] h-[16px] bg-amber-500 text-black text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 z-20 shadow">
                  {markedEntry.order}
                </span>
              )}
            </span>
          );
        })}
      </p>

      {/* 译文区块 */}
      <div
        className={cn(
          "mt-4 border-l-2 border-zinc-800 pl-4 transition-all duration-300 overflow-hidden",
          showTranslation ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        )}
      >
        {seg.translation ? (
          <p className="text-zinc-500 text-base leading-relaxed font-sans">{seg.translation}</p>
        ) : (
          <p className="text-zinc-600/50 text-sm italic">暂无译文</p>
        )}
      </div>
    </div>
  );
});


interface SelectedWordContext {
  id: string;
  text: string;
  segmentIndex: number;
  wordIndex: number;
}

export function AnalysisView({
  onBack,
  onNextPhase,
  audioRef,
  currentTime,
  isPlaying,
  seek,
  transcript,
  markedWords,
  onMarkWord,
  onUnmarkWord,
  materialTitle
}: AnalysisViewProps) {
  const [selectedWordEntry, setSelectedWordEntry] = useState<DictionaryEntry | null>(null);
  const [selectedWordContext, setSelectedWordContext] = useState<SelectedWordContext | null>(null);
  const [showVocabularySheet, setShowVocabularySheet] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [isDictionaryLoading, setIsDictionaryLoading] = useState(false);
  const [dictionarySource, setDictionarySource] = useState<'local' | 'online' | 'none'>('none');
  const dictionaryLookupTokenRef = useRef(0);

  // 🔖 构建 markedWords 快查 Map
  const markedWordMap = useMemo(() => {
    const map = new Map<string, MarkedWord>();
    markedWords.forEach(w => map.set(w.id, w));
    return map;
  }, [markedWords]);

  const vocabularyItems = useMemo<VocabularyItem[]>(() => {
    return [...markedWords]
      .sort((a, b) => a.order - b.order)
      .map(markedWord => {
        const segment = transcript[markedWord.segmentIndex];
        const transcriptWord = segment?.words?.[markedWord.wordIndex];
        const text = transcriptWord?.text || markedWord.text;
        return {
          ...markedWord,
          text,
          sentence: segment?.text || "",
          sentenceStart: segment?.start || 0,
          sentenceEnd: segment?.end || 0,
          dictionaryEntry: lookupWord(text)
        };
      });
  }, [markedWords, transcript]);

  // 🎵 当前循环节（段落）的状态
  const [activeSegment, setActiveSegment] = useState<{ start: number; end: number } | null>(null);

  // 🎵 段落结束时自动循环
  useEffect(() => {
    if (activeSegment !== null && isPlaying && currentTime >= activeSegment.end) {
      seek(activeSegment.start);
    }
  }, [currentTime, isPlaying, activeSegment, seek]);

  const handleSegmentPlay = useCallback((e: React.MouseEvent, startTime: number, endTime: number) => {
    e.stopPropagation();

    // 标记当前属于哪个段落，用于循环
    setActiveSegment({ start: startTime, end: endTime });

    // 如果当前时间已经在这个段落之中，说明是“暂停后的继续播放”，不需要从头 seek
    // 只有当时间不在段落内部时，才 seek 到句首
    if (currentTime < startTime || currentTime >= endTime) {
      seek(startTime);
    }

    if (audioRef.current) {
      audioRef.current.play().catch(() => { });
    }
  }, [currentTime, seek, audioRef]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => { });
    }
  }, [isPlaying, audioRef]);

  // Recitation Mode State
  const [recitationMode, setRecitationMode] = useState<RecitationMode>('off');
  const [hiddenIndices, setHiddenIndices] = useState<Set<string>>(new Set());

  // Translation Toggle State (default ON)
  const [showTranslation, setShowTranslation] = useState(true);

  // ... (Keep existing useEffects for Highlight, Scroll, Recitation)
  const [showEntryHighlight, setShowEntryHighlight] = useState(true);
  // Disable entry highlight after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowEntryHighlight(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    if (activeWordRef.current && scrollBoxRef.current && !hasScrolledRef.current) {
      const element = activeWordRef.current;
      element.scrollIntoView({ behavior: 'auto', block: 'center' });
      hasScrolledRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (recitationMode === 'partial') {
      const indices = new Set<string>();
      transcript.forEach((seg, sIdx) => {
        seg.words?.forEach((word, wIdx) => {
          // Only hide actual words (any language), not punctuation
          const isRealWord = /\p{L}|\p{N}/u.test(word.text);
          if (isRealWord && Math.random() < 0.7) {
            indices.add(`${sIdx}-${wIdx}`);
          }
        });
      });
      setHiddenIndices(indices);
    }
  }, [recitationMode, transcript]);

  const handleRecitationToggle = () => {
    setRecitationMode(prev => {
      if (prev === 'off') return 'partial';
      if (prev === 'partial') return 'full';
      return 'off';
    });
  };

  const handleWordClick = useCallback(async (word: string, sentenceIdx: number, wordIdx: number) => {
    const id = `${sentenceIdx}-${wordIdx}`;
    const token = dictionaryLookupTokenRef.current + 1;
    dictionaryLookupTokenRef.current = token;
    setSelectedWordContext({ id, text: word, segmentIndex: sentenceIdx, wordIndex: wordIdx });
    const entry = lookupWord(word);
    if (entry) {
      setSelectedWordEntry(entry);
      setDictionarySource('local');
      setIsDictionaryLoading(false);
      return;
    }

    setSelectedWordEntry({
      word: word.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, "") || word,
      phonetic: "",
      meanings: [{ partOfSpeech: "word", definitions: ["正在查询释义..."] }]
    });
    setDictionarySource('none');
    setIsDictionaryLoading(true);

    const onlineEntry = await lookupOnlineDictionary(word);
    if (dictionaryLookupTokenRef.current !== token) return;

    if (onlineEntry) {
      setSelectedWordEntry(onlineEntry);
      setDictionarySource('online');
    } else {
      setSelectedWordEntry({
        word: word.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, "") || word,
        phonetic: "",
        meanings: [{ partOfSpeech: "word", definitions: ["暂时查不到中文释义"] }]
      });
      setDictionarySource('none');
    }
    setIsDictionaryLoading(false);
  }, []);

  const handlePlaySentence = useCallback((item: VocabularyItem) => {
    seek(item.sentenceStart);
    audioRef.current?.play().catch(() => { });
  }, [audioRef, seek]);

  const handleJumpToWord = useCallback((item: VocabularyItem) => {
    setShowVocabularySheet(false);
    setSelectedWordContext({
      id: item.id,
      text: item.text,
      segmentIndex: item.segmentIndex,
      wordIndex: item.wordIndex
    });
    const entry = lookupWord(item.text);
    if (entry) {
      setSelectedWordEntry(entry);
      setDictionarySource('local');
      setIsDictionaryLoading(false);
    }
    seek(item.sentenceStart);
    requestAnimationFrame(() => {
      const active = scrollBoxRef.current?.querySelector(`[data-segment-index="${item.segmentIndex}"]`);
      active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [seek]);


  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* NavBar */}
      <div className="px-6 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-6 flex justify-between items-center border-b border-zinc-900 bg-black/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-medium text-zinc-500 tracking-widest uppercase">第二步</span>
          <span className="text-sm font-semibold text-white tracking-tight">弄懂 背下来</span>
        </div>
        {/* Translation Toggle */}
        <div className="flex items-center gap-2">
          <StepGuideModal
            stepKey="analysis"
            title="第二步方法提示"
            onOpen={() => audioRef.current?.pause()}
            onClose={() => {
              if (isPlaying) audioRef.current?.play().catch(() => { });
            }}
            description={
              <div className="flex flex-col gap-4 text-left">
                <p>理解单词和不明白的上下文。</p>
                <p>再次去听和跟读。</p>
                <p>目标复述乃至背诵出整段材料。</p>
              </div>
            }
          />
          <button
            onClick={handleRecitationToggle}
            title={recitationMode === 'off' ? '开启默写模式' : recitationMode === 'partial' ? '全部遮挡' : '关闭默写模式'}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
              recitationMode !== 'off' ? "text-indigo-400" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            {recitationMode === 'off' ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <label htmlFor="trans-toggle" className="text-xs font-medium text-zinc-500 cursor-pointer select-none">译</label>
          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className={cn(
              "w-11 h-6 rounded-full border relative transition-colors duration-300 focus:outline-none ring-offset-2 ring-offset-black focus:ring-2 focus:ring-indigo-600/50",
              showTranslation
                ? "bg-indigo-600 border-indigo-500"
                : "bg-zinc-800 border-zinc-700"
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 w-4.5 h-4.5 rounded-full shadow-sm transition-all duration-300 transform",
                showTranslation
                  ? "translate-x-5 bg-white"
                  : "translate-x-0 bg-zinc-400"
              )}
              style={{ width: '18px', height: '18px' }}
            />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8 flex items-start justify-center relative no-scrollbar" ref={scrollBoxRef}>
        <div className="space-y-12 text-2xl md:text-3xl font-sans font-medium leading-relaxed tracking-wide text-left max-w-xl mx-auto text-zinc-300 pb-20 w-full">
          {transcript.map((seg, idx) => {
            const isSegActiveOrNearby = currentTime >= (seg.start - 5) && currentTime <= (seg.end + 5);
            return (
              <ParagraphRow
                key={idx}
                seg={seg}
                idx={idx}
                currentTime={isSegActiveOrNearby ? currentTime : 0}
                isPlaying={isPlaying}
                recitationMode={recitationMode}
                hiddenIndices={hiddenIndices}
                markedWordMap={markedWordMap}
                selectedWordId={selectedWordContext?.id}
                showEntryHighlight={showEntryHighlight}
                hasScrolledRefFocus={hasScrolledRef.current}
                activeWordRef={activeWordRef}
                showTranslation={showTranslation}
                handleSegmentPlay={handleSegmentPlay}
                handleWordClick={handleWordClick}
                togglePlay={togglePlay}
              />
            );
          })}
        </div>
      </div>


      {/* Footer Action */}
      <div className="p-6 bg-black border-t border-zinc-900 shrink-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {/* Button Container - Centered on larger screens */}
        <div className="max-w-2xl mx-auto flex gap-3">
          <button
            onClick={() => setShowVocabularySheet(true)}
            disabled={markedWords.length === 0}
            className={cn(
              "w-[30%] min-w-[92px] p-4 rounded-xl font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 border",
              markedWords.length > 0
                ? "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/15"
                : "bg-zinc-950 text-zinc-700 border-zinc-900"
            )}
          >
            <ListChecks className="w-5 h-5" />
            <span>生词 {markedWords.length}</span>
          </button>

          {/* AI 助记 */}
          <button
            onClick={() => markedWords.length > 0 && setShowMnemonic(true)}
            disabled={markedWords.length === 0}
            title={markedWords.length === 0 ? '先在原文中长按标记生词' : ''}
            className={cn(
              "flex-1 p-4 rounded-xl font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 border active:scale-95",
              markedWords.length > 0
                ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20"
                : "bg-zinc-950 text-zinc-700 border-zinc-900 cursor-not-allowed"
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span>AI 助记</span>
          </button>

          {/* Primary Action */}
          <button
            onClick={onNextPhase}
            className="w-[30%] min-w-[86px] py-4 rounded-xl bg-white text-black font-semibold text-sm tracking-wide hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5 active:scale-95"
          >
            <span>下一步</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Dictionary Modal */}
      {selectedWordEntry && (
        <>
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px] z-50 transition-opacity"
            onClick={() => setSelectedWordEntry(null)}
          ></div>
          <div className="absolute bottom-0 left-0 right-0 bg-[#18181b] border border-white/10 border-b-0 rounded-t-[28px] p-6 z-50 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-[0_-24px_80px_rgba(0,0,0,0.78)] animate-in slide-in-from-bottom duration-300">
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-3xl font-bold text-white mb-1">{selectedWordEntry.word}</h3>
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="font-mono text-sm">{selectedWordEntry.phonetic}</span>
                  <button
                    onClick={() => {
                      // 🔊 Use Web Speech API for pronunciation
                      const utterance = new SpeechSynthesisUtterance(selectedWordEntry.word);
                      utterance.lang = 'en-US'; // American English
                      utterance.rate = 0.9; // Slightly slower for clarity
                      utterance.volume = 1.0; // Match audio file volume
                      speechSynthesis.speak(utterance);
                    }}
                    className="p-1 rounded-full bg-zinc-800 hover:bg-zinc-700">
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  dictionaryLookupTokenRef.current += 1;
                  setSelectedWordEntry(null);
                  setIsDictionaryLoading(false);
                }}
                className="p-2 bg-white/8 rounded-full text-zinc-400 hover:text-white hover:bg-white/12"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {selectedWordContext && (
                <button
                  onClick={() => {
                    if (markedWordMap.has(selectedWordContext.id)) {
                      onUnmarkWord(selectedWordContext.id);
                    } else {
                      onMarkWord({
                        id: selectedWordContext.id,
                        text: selectedWordContext.text,
                        segmentIndex: selectedWordContext.segmentIndex,
                        wordIndex: selectedWordContext.wordIndex
                      });
                    }
                  }}
                  className={cn(
                    "w-full h-12 rounded-xl border flex items-center justify-center gap-2 text-sm font-semibold transition-all active:scale-[0.99]",
                    markedWordMap.has(selectedWordContext.id)
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/15"
                      : "bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700"
                  )}
                >
                  {markedWordMap.has(selectedWordContext.id) ? (
                    <>
                      <BookmarkX className="w-4 h-4" />
                      <span>取消标记</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="w-4 h-4" />
                      <span>标记生词</span>
                    </>
                  )}
                </button>
              )}

              {isDictionaryLoading && (
                <div className="rounded-xl bg-zinc-800/60 border border-zinc-700/60 px-4 py-3 flex items-center gap-3 text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
                  <span className="text-sm">正在查询释义...</span>
                </div>
              )}

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

              {dictionarySource === 'online' && (
                <p className="text-[11px] text-zinc-600 leading-relaxed">
                  中文释义来自 Wiktionary 翻译数据。
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <VocabularySheet
        open={showVocabularySheet}
        items={vocabularyItems}
        onClose={() => setShowVocabularySheet(false)}
        onPlaySentence={handlePlaySentence}
        onJumpToWord={handleJumpToWord}
        onUnmarkWord={onUnmarkWord}
      />

      <MnemonicSheet
        isOpen={showMnemonic}
        onClose={() => setShowMnemonic(false)}
        markedWords={markedWords}
        transcript={transcript}
        materialTitle={materialTitle}
      />

    </div>
  );
}
