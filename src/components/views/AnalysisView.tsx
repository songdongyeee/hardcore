import { ArrowRight, ChevronLeft, Volume2, X, BookOpen, Eye, EyeOff } from "lucide-react";
import { transcript } from "@/data/transcript";
import { lookupWord, type DictionaryEntry } from "@/data/dictionary";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import nlp from "compromise"; // NLP
import { Haptics, ImpactStyle } from '@capacitor/haptics'; // Haptics
// import { useLongPress } from "@/hooks/useLongPress"; // Removed unused import
import { SentenceAnalysisSheet } from "@/components/SentenceAnalysisSheet"; // UI
import { SentenceWrapper } from "@/components/SentenceWrapper";

interface AnalysisViewProps {
  onBack: () => void;
  onNextPhase: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  isPlaying: boolean;
  seek: (time: number) => void;
}

type RecitationMode = 'off' | 'partial' | 'full';

interface AnalysisData {
  verbs: string[];
  nouns: string[];
  tense: string;
  // New Fields
  sentiment: 'Positive' | 'Negative' | 'Neutral';
  sentenceType: string;
  focusWords: string[];
}

export function AnalysisView({ onBack, onNextPhase, audioRef: _audioRef, currentTime, isPlaying: _isPlaying, seek: _seek }: AnalysisViewProps) {
  const [showEntryHighlight, setShowEntryHighlight] = useState(true);
  const [selectedWordEntry, setSelectedWordEntry] = useState<DictionaryEntry | null>(null);

  // Grammar Vision State
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);

  // Recitation Mode State
  const [recitationMode, setRecitationMode] = useState<RecitationMode>('off');
  const [hiddenIndices, setHiddenIndices] = useState<Set<string>>(new Set());

  // ... (Keep existing useEffects for Highlight, Scroll, Recitation)
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
        seg.words?.forEach((_, wIdx) => {
          if (Math.random() < 0.7) indices.add(`${sIdx}-${wIdx}`);
        });
      });
      setHiddenIndices(indices);
    }
  }, [recitationMode]);

  const handleRecitationToggle = () => {
    setRecitationMode(prev => prev === 'off' ? 'partial' : prev === 'partial' ? 'full' : 'off');
  };

  const handleWordClick = (word: string) => {
    if (activeSentenceIndex !== null) return; // Prevent dictionary if analyzing
    const entry = lookupWord(word);
    if (entry) setSelectedWordEntry(entry);
  };

  // --- Grammar Vision Logic ---
  const handleSentenceAnalysis = async (text: string, index: number) => {
    // 1. Haptics
    await Haptics.impact({ style: ImpactStyle.Medium });

    // 2. Analyze
    const doc = nlp(text);
    const verbs = doc.verbs().out('array');
    const nouns = doc.nouns().out('array');

    // Tense Heuristic
    const isPast = doc.verbs().toPastTense().out('text') === doc.verbs().out('text');
    const tense = isPast ? "Past" : "Present/Future";

    // Sentiment Heuristic (Very basic based on adjectives/adverbs)
    // In a real app, use a dedicated sentiment library
    const negativeWords = doc.match('(not|never|no|bad|hard|difficult|fail|wrong)').out('array');
    const positiveWords = doc.match('(good|great|best|success|honor|love|truth|right)').out('array');
    let sentiment: 'Positive' | 'Negative' | 'Neutral' = 'Neutral';
    if (negativeWords.length > positiveWords.length) sentiment = 'Negative';
    else if (positiveWords.length > negativeWords.length) sentiment = 'Positive';

    // Sentence Type
    let sentenceType = "Declarative"; // Statement
    if (text.trim().endsWith('?')) sentenceType = "Interrogative"; // Question
    else if (text.trim().endsWith('!')) sentenceType = "Exclamatory"; // Exclamation

    // Focus Words (Adjectives + Adverbs for emotional coloring)
    const focusWords = doc.match('(#Adjective|#Adverb)').out('array');

    setAnalysisResult({
      verbs: verbs.slice(0, 3), // Limit to top 3
      nouns: nouns.slice(0, 3), // Limit to top 3
      tense: tense,
      sentiment: sentiment,
      sentenceType: sentenceType,
      focusWords: focusWords.slice(0, 5) // Limit to top 5
    });
    setActiveSentenceIndex(index);
  };

  const closeAnalysis = () => {
    setActiveSentenceIndex(null);
    setAnalysisResult(null);
  };

  return (
    <div className="absolute inset-0 bg-black z-40 flex flex-col h-full w-full">
      {/* Nav ... same ... */}
      <div className="px-6 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-6 flex justify-between items-center border-b border-zinc-900 bg-black/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-medium text-zinc-500 tracking-widest uppercase">Phase 2</span>
          <span className="text-sm font-semibold text-white tracking-tight">The Lab</span>
        </div>
        <div className="w-8"></div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 flex items-start justify-center relative" ref={scrollBoxRef}>
        <div className="space-y-6 text-lg md:text-xl font-medium leading-relaxed tracking-tight text-left max-w-md text-zinc-300">
          {transcript.map((seg, idx) => {
            // Create a wrapper component logic inline or explicit
            // We need to attach handlers to the PARAGRAPH.
            const isAnalyzed = activeSentenceIndex === idx;

            return (
              <SentenceWrapper
                key={idx}
                isActive={isAnalyzed}
                onLongPress={() => handleSentenceAnalysis(seg.text, idx)}
              >
                {seg.words?.map((word, wIdx) => {
                  const isWordActive = currentTime >= word.start && currentTime < word.end;
                  const refProps = isWordActive && !hasScrolledRef.current ? { ref: activeWordRef } : {};
                  const isSelected = selectedWordEntry?.word.toLowerCase() === word.text.toLowerCase().replace(/[^a-z]/g, "");

                  let isHidden = false;
                  if (recitationMode === 'full') isHidden = true;
                  else if (recitationMode === 'partial' && hiddenIndices.has(`${idx}-${wIdx}`)) isHidden = true;

                  return (
                    <span key={wIdx} className="inline-block mr-1.5 relative group">
                      <span
                        {...refProps}
                        onClick={(e) => {
                          e.stopPropagation(); // Ensure word click doesn't bubble
                          handleWordClick(word.text);
                        }}
                        className={cn(
                          "transition-all duration-300 cursor-pointer px-0.5 rounded border-b border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900",
                          isWordActive && showEntryHighlight && "bg-indigo-500/80 text-white shadow-lg shadow-indigo-500/20",
                          isWordActive && !showEntryHighlight && "text-indigo-400",
                          isSelected && "text-amber-400 bg-amber-500/20 border-amber-500/50",
                          isHidden && !isWordActive && "bg-zinc-800 text-transparent select-none border-transparent",
                          isHidden && isWordActive && "bg-indigo-500/50 text-transparent"
                        )}
                      >
                        {word.text}
                      </span>
                    </span>
                  );
                }) || seg.text}
              </SentenceWrapper>
            );
          })}
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
            className="absolute inset-0 bg-black/40 z-50 transition-opacity"
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
      {/* Analysis Sheet */}
      <SentenceAnalysisSheet
        sentence={activeSentenceIndex !== null ? transcript[activeSentenceIndex].text : ""}
        analysis={analysisResult}
        onClose={closeAnalysis}
      />

    </div>
  );
}
