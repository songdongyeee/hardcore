import type { MarkedWord } from "@/App";
import type { DictionaryEntry } from "@/data/dictionary";
import { lookupOnlineDictionary } from "@/lib/onlineDictionary";
import { cn } from "@/lib/utils";
import { BookOpen, Check, ChevronLeft, ChevronRight, Layers, List, Loader2, MapPin, Play, RotateCcw, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface VocabularyItem extends MarkedWord {
  sentence: string;
  sentenceStart: number;
  sentenceEnd: number;
  dictionaryEntry: DictionaryEntry | null;
}

interface VocabularySheetProps {
  open: boolean;
  items: VocabularyItem[];
  onClose: () => void;
  onPlaySentence: (item: VocabularyItem) => void;
  onJumpToWord: (item: VocabularyItem) => void;
  onUnmarkWord: (wordId: string) => void;
}

type VocabularyMode = "list" | "cards";

function cleanWord(word: string) {
  return word.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, "") || word;
}

function getPrimaryDefinition(entry: DictionaryEntry | null) {
  return entry?.meanings?.[0]?.definitions?.[0] || "暂无中文释义";
}

function speak(text: string) {
  const utterance = new SpeechSynthesisUtterance(cleanWord(text));
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

function ContextSentence({ sentence, word }: { sentence: string; word: string }) {
  const cleaned = cleanWord(word);
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = escaped ? sentence.split(new RegExp(`(${escaped})`, "i")) : [sentence];

  return (
    <p className="text-sm leading-relaxed text-zinc-400">
      {parts.map((part, index) => {
        const isMatch = part.toLowerCase() === cleaned.toLowerCase();
        return isMatch ? (
          <span key={`${part}-${index}`} className="text-indigo-200 bg-indigo-400/12 rounded px-1">
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </p>
  );
}

export function VocabularySheet({
  open,
  items,
  onClose,
  onPlaySentence,
  onJumpToWord,
  onUnmarkWord
}: VocabularySheetProps) {
  const [mode, setMode] = useState<VocabularyMode>("list");
  const [cardIndex, setCardIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [repeatIds, setRepeatIds] = useState<Set<string>>(new Set());
  const [onlineEntries, setOnlineEntries] = useState<Record<string, DictionaryEntry | null>>({});
  const [loadingEntryIds, setLoadingEntryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setCardIndex(0);
    setIsRevealed(false);
  }, [open]);

  useEffect(() => {
    setCardIndex(prev => Math.min(prev, Math.max(items.length - 1, 0)));
  }, [items.length]);

  const activeCard = items[cardIndex];
  const repeatCount = useMemo(() => items.filter(item => repeatIds.has(item.id)).length, [items, repeatIds]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const missingItems = items.filter(item => !item.dictionaryEntry && onlineEntries[item.id] === undefined).slice(0, 16);
    if (missingItems.length === 0) return;

    setLoadingEntryIds(prev => {
      const next = new Set(prev);
      missingItems.forEach(item => next.add(item.id));
      return next;
    });

    const loadEntries = async () => {
      for (const item of missingItems) {
        const entry = await lookupOnlineDictionary(item.text);
        if (cancelled) return;
        setOnlineEntries(prev => ({ ...prev, [item.id]: entry }));
        setLoadingEntryIds(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    };

    loadEntries();

    return () => {
      cancelled = true;
    };
  }, [items, onlineEntries, open]);

  const getEntry = (item: VocabularyItem) => item.dictionaryEntry || onlineEntries[item.id] || null;
  const isEntryLoading = (item: VocabularyItem) => !item.dictionaryEntry && loadingEntryIds.has(item.id);

  if (!open) return null;

  const goNext = () => {
    if (items.length === 0) return;
    setCardIndex(prev => (prev + 1) % items.length);
    setIsRevealed(false);
  };

  const goPrev = () => {
    if (items.length === 0) return;
    setCardIndex(prev => (prev - 1 + items.length) % items.length);
    setIsRevealed(false);
  };

  const markKnown = (item: VocabularyItem) => {
    setKnownIds(prev => new Set(prev).add(item.id));
    setRepeatIds(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    goNext();
  };

  const markRepeat = (item: VocabularyItem) => {
    setRepeatIds(prev => new Set(prev).add(item.id));
    setKnownIds(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    goNext();
  };

  return (
    <>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] z-[70]" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-[80] bg-[#161618] border border-white/10 border-b-0 rounded-t-[28px] shadow-[0_-24px_80px_rgba(0,0,0,0.75)] max-h-[86%] pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom duration-300 overflow-hidden">
        <div className="h-7 flex items-center justify-center">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-4 border-b border-white/10 bg-[#161618]/95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-zinc-400 font-medium tracking-widest uppercase">本篇生词</p>
              <h3 className="text-2xl font-bold text-white mt-1">{items.length} 个标记</h3>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/8 text-zinc-300 flex items-center justify-center hover:text-white hover:bg-white/12 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 rounded-xl bg-black/25 border border-white/10 p-1">
            <button
              onClick={() => setMode("list")}
              className={cn(
                "h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all",
                mode === "list" ? "bg-white/12 text-white border border-white/10 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <List className="w-4 h-4" />
              <span>列表</span>
            </button>
            <button
              onClick={() => setMode("cards")}
              className={cn(
                "h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all",
                mode === "cards" ? "bg-white/12 text-white border border-white/10 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Layers className="w-4 h-4" />
              <span>卡片</span>
            </button>
          </div>

        </div>

        {items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <BookOpen className="w-8 h-8 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500 text-sm">还没有标记生词</p>
          </div>
        ) : mode === "list" ? (
          <div className="overflow-y-auto max-h-[50vh] px-4 py-4 space-y-3 no-scrollbar bg-[#111113]">
            {items.map(item => {
              const entry = getEntry(item);
              const isKnown = knownIds.has(item.id);
              const needsRepeat = repeatIds.has(item.id);
              const isLoadingEntry = isEntryLoading(item);

              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-2xl border bg-white/[0.055] p-4 transition-colors shadow-sm shadow-black/10",
                    isKnown ? "border-emerald-400/25" : needsRepeat ? "border-indigo-300/30" : "border-white/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="min-w-[22px] h-[22px] rounded-full bg-amber-500/18 border border-amber-400/25 text-amber-300 text-xs font-bold flex items-center justify-center">
                          {item.order}
                        </span>
                        <h4 className="text-xl font-bold text-amber-200 truncate">{cleanWord(item.text)}</h4>
                        {entry?.phonetic && <span className="text-xs font-mono text-zinc-500 truncate">{entry.phonetic}</span>}
                      </div>
                      <p className="text-sm text-zinc-300 mt-2 leading-relaxed flex items-start gap-2">
                        {isLoadingEntry && <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin text-zinc-500 shrink-0" />}
                        <span>{isLoadingEntry ? "正在查询释义..." : getPrimaryDefinition(entry)}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => speak(item.text)}
                      className="shrink-0 w-9 h-9 rounded-full bg-zinc-900 text-indigo-300 flex items-center justify-center hover:bg-zinc-800 transition-colors"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-4 border-l-2 border-zinc-800 pl-3">
                    <ContextSentence sentence={item.sentence} word={item.text} />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      onClick={() => onPlaySentence(item)}
                      className="h-10 rounded-lg bg-zinc-900 text-zinc-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-zinc-800 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>原句</span>
                    </button>
                    <button
                      onClick={() => onJumpToWord(item)}
                      className="h-10 rounded-lg bg-zinc-900 text-zinc-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-zinc-800 transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>定位</span>
                    </button>
                    <button
                      onClick={() => onUnmarkWord(item.id)}
                      className="h-10 rounded-lg bg-zinc-900 text-red-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>移除</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : activeCard ? (
          <div className="px-5 py-5 bg-[#111113]">
            <div className="flex items-center justify-between text-xs text-zinc-500 font-medium mb-4">
              <span>{cardIndex + 1} / {items.length}</span>
              <span>再看 {repeatCount}</span>
            </div>

            <button
              onClick={() => setIsRevealed(prev => !prev)}
              className="w-full min-h-[260px] rounded-2xl border border-white/10 bg-[#1c1c1f] p-6 text-left active:scale-[0.99] transition-transform shadow-sm shadow-black/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-amber-300 font-bold tracking-widest uppercase">#{activeCard.order}</p>
                  <h4 className="text-4xl font-black text-amber-100 mt-3 break-words">{cleanWord(activeCard.text)}</h4>
                  {getEntry(activeCard)?.phonetic && (
                    <p className="text-sm font-mono text-zinc-500 mt-2">{getEntry(activeCard)?.phonetic}</p>
                  )}
                </div>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    speak(activeCard.text);
                  }}
                  className="shrink-0 w-10 h-10 rounded-full bg-zinc-900 text-indigo-300 flex items-center justify-center"
                >
                  <Volume2 className="w-5 h-5" />
                </span>
              </div>

              <div className={cn("mt-8 space-y-5 transition-opacity", isRevealed ? "opacity-100" : "opacity-20")}>
                <p className="text-base leading-relaxed text-zinc-200">
                  {isRevealed ? getPrimaryDefinition(getEntry(activeCard)) : "点击查看释义"}
                </p>
                {isRevealed && (
                  <div className="border-l-2 border-zinc-800 pl-3">
                    <ContextSentence sentence={activeCard.sentence} word={activeCard.text} />
                  </div>
                )}
              </div>
            </button>

            <div className="grid grid-cols-[44px_1fr_1fr_44px] gap-2 mt-4">
              <button onClick={goPrev} className="h-12 rounded-xl bg-zinc-900 text-zinc-300 flex items-center justify-center">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => markRepeat(activeCard)}
                className="h-12 rounded-xl bg-white/8 border border-white/10 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>再看</span>
              </button>
              <button
                onClick={() => markKnown(activeCard)}
                className="h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>认识</span>
              </button>
              <button onClick={goNext} className="h-12 rounded-xl bg-zinc-900 text-zinc-300 flex items-center justify-center">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
