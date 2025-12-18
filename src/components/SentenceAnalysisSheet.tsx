import { X, Zap, Box, Clock, Heart, MessageSquare, Sparkles } from "lucide-react";


interface AnalysisData {
    verbs: string[];
    nouns: string[];
    tense: string;
    sentiment: 'Positive' | 'Negative' | 'Neutral';
    sentenceType: string;
    focusWords: string[];
}

interface SentenceAnalysisSheetProps {
    sentence: string;
    analysis: AnalysisData | null;
    onClose: () => void;
}

export function SentenceAnalysisSheet({ sentence, analysis, onClose }: SentenceAnalysisSheetProps) {
    if (!analysis) return null;

    return (
        <>
            <div
                className="absolute inset-0 bg-black/40 z-50 transition-opacity animate-in fade-in duration-300"
                onClick={onClose}
            ></div>
            <div
                className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-3xl z-50 pb-[calc(2rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300 shadow-2xl overflow-hidden select-none"
                style={{
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    userSelect: 'none'
                }}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                        <div className="w-1 h-4 bg-amber-500 rounded-full"></div>
                        <h3 className="text-lg font-bold text-white tracking-tight">Grammar Vision</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {/* Target Sentence */}
                    <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/50 shadow-inner">
                        <p className="text-lg text-zinc-200 leading-relaxed font-serif italic">
                            "{sentence}"
                        </p>
                    </div>

                    {/* Analysis Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                        {/* Core Verbs */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs tracking-wider uppercase">
                                <Zap className="w-4 h-4" />
                                <span>Core Verbs</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {analysis.verbs.length > 0 ? analysis.verbs.map((v, i) => (
                                    <span key={i} className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/20 text-sm font-medium">
                                        {v}
                                    </span>
                                )) : <span className="text-zinc-600 text-sm italic">None detected</span>}
                            </div>
                        </div>

                        {/* Key Nouns */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs tracking-wider uppercase">
                                <Box className="w-4 h-4" />
                                <span>Key Nouns</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {analysis.nouns.length > 0 ? analysis.nouns.map((n, i) => (
                                    <span key={i} className="px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-300 border border-sky-500/20 text-sm font-medium">
                                        {n}
                                    </span>
                                )) : <span className="text-zinc-600 text-sm italic">None detected</span>}
                            </div>
                        </div>

                        {/* Tense */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs tracking-wider uppercase">
                                <Clock className="w-4 h-4" />
                                <span>Tense</span>
                            </div>
                            <span className="inline-block px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-sm font-medium">
                                {analysis.tense || "Undefined"}
                            </span>
                        </div>

                        {/* Sentence Type */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-orange-400 font-semibold text-xs tracking-wider uppercase">
                                <MessageSquare className="w-4 h-4" />
                                <span>Type</span>
                            </div>
                            <span className="inline-block px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-300 border border-orange-500/20 text-sm font-medium">
                                {analysis.sentenceType}
                            </span>
                        </div>

                        {/* Sentiment */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-pink-400 font-semibold text-xs tracking-wider uppercase">
                                <Heart className="w-4 h-4" />
                                <span>Tone</span>
                            </div>
                            <span className="inline-block px-3 py-1.5 rounded-lg bg-pink-500/10 text-pink-300 border border-pink-500/20 text-sm font-medium">
                                {analysis.sentiment}
                            </span>
                        </div>

                        {/* Focus / Descriptive Words */}
                        <div className="space-y-3 md:col-span-3">
                            <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs tracking-wider uppercase">
                                <Sparkles className="w-4 h-4" />
                                <span>Emotional Focus (Adj/Adv)</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {analysis.focusWords.length > 0 ? analysis.focusWords.map((w, i) => (
                                    <span key={i} className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/20 text-sm font-medium">
                                        {w}
                                    </span>
                                )) : <span className="text-zinc-600 text-sm italic">Neutral phrasing</span>}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
}
