import { useState, useEffect } from "react";
import { type Material } from "@/components/MaterialCard";
import { Menu, Sparkles, Upload, Library, BookOpen, Star, Filter } from "lucide-react";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { Paywall } from "@/components/Paywall";
import { pickAudioFile } from "@/utils/fileHandler";
import { whisperService } from "@/services/whisperService";
import { audioConverter } from "@/services/audioConverter";
import { cn } from "@/lib/utils";
import type { TranscriptSegment } from "@/data/transcript";

// New circular progress component
function CircularProgress({ progress }: { progress: number }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <svg className="transform -rotate-90 w-full h-full" viewBox="0 0 24 24">
        <circle
          className="text-zinc-800"
          strokeWidth="2"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="12"
          cy="12"
        />
        <circle
          className="text-indigo-500 transition-all duration-300 ease-in-out"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="12"
          cy="12"
        />
      </svg>
      {/* Upload icon inside */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Upload className="w-3 h-3 text-white animate-pulse" />
      </div>
    </div>
  );
}

interface HomeViewProps {
  onPlay: (audioUrl: string, targetView?: 'listening' | 'shadowing', transcript?: TranscriptSegment[]) => void;
  onProfile: () => void;
}

const MATERIALS: Material[] = [
  {
    id: '1',
    title: 'Steve Jobs: Stanford Commencement Speech',
    subtitle: 'Stay Hungry, Stay Foolish. A legendary speech on connecting dots.',
    imageUrl: '/images/steve_jobs.jpg',
    duration: '14:02',
    label: { text: '日练短句', type: 'new' }, // Using 'new' style for the demo match
    progress: 45,
    audioUrl: '/演讲音频.m4a',
    isStarred: true
  },
  {
    id: '2',
    title: 'The Psychology of Money',
    subtitle: 'Timeless lessons on wealth, greed, and happiness.',
    imageUrl: '/images/bbc_news.jpg',
    duration: '03:21',
    label: { text: '精品长文', type: 'mastered' },
    audioUrl: '/演讲音频.m4a',
    isStarred: true
  },
  {
    id: '3',
    title: 'Zero to One',
    subtitle: 'Notes on Startups, or How to Build the Future.',
    imageUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=1000&auto=format&fit=crop', // Using placeholder from demo
    duration: '12:08',
    label: { text: '科技新闻', type: 'hard' },
    audioUrl: '/演讲音频.m4a'
  },
  {
    id: '4',
    title: 'The Art of War',
    subtitle: 'Sun Tzu\'s ancient military strategy treatise.',
    imageUrl: 'https://images.unsplash.com/photo-1640906152676-dace6710d24b?w=2160&q=80',
    duration: '15:30',
    label: { text: '自制上传', type: 'new' },
    audioUrl: '/演讲音频.m4a'
  }
];

export function HomeView({ onPlay, onProfile }: HomeViewProps) {
  // Removed unused activeId state
  const [showPaywall, setShowPaywall] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // Refactored Filter State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'starred' | 'reading'>('all');

  const { isVip } = useRevenueCat();
  const { checkAccess } = useUsageLimit(isVip);

  // Filter Logic
  const displayMaterials = activeFilter === 'starred'
    ? MATERIALS.filter(m => m.isStarred)
    : MATERIALS.slice(1); // Show all except first (Hero) in grid

  // Scroll Animation Logic
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            const ratio = entry.intersectionRatio;

            if (ratio > 0.5) {
              target.style.transform = 'scale(1)';
              target.style.opacity = '1';
              target.style.filter = 'brightness(1)';
            } else {
              // Use dynamic values to smooth out the transition slightly or just simpler toggle
              const scale = 0.95 + (Math.max(0, ratio - 0.2) * 0.05 / 0.8);
              const opacity = 0.8 + (Math.max(0, ratio - 0.2) * 0.2 / 0.8);

              target.style.transform = `scale(${scale})`;
              target.style.opacity = `${opacity}`;
              target.style.filter = 'brightness(0.7)';
            }
          }
        });
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], rootMargin: '-10% 0px -10% 0px' }
    );

    const cards = document.querySelectorAll('.animate-card');
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [activeFilter]);

  const handleCardClick = async (material: Material) => {
    // Logic: Free User can only access the first article (id '1')
    if (!isVip && material.id !== '1') {
      setShowPaywall(true);
      return;
    }

    const access = await checkAccess(material.id);
    if (access.allowed) {
      onPlay(material.audioUrl);
    } else {
      setShowPaywall(true);
    }
  };

  const handleImport = async () => {
    if (isImporting) return;
    setIsImporting(true);

    try {
      const file = await pickAudioFile();
      if (!file) {
        setIsImporting(false);
        return;
      }

      setImportProgress(0);

      let finalUri = file.uri;
      let finalWebPath = file.webPath;

      // 1. Convert if Video
      const isVideo = file.name.match(/\.(mp4|mov|avi|m4v)$/i);

      if (isVideo) {
        console.log("Video detected, starting conversion...");
        finalUri = await audioConverter.extractAudio(file.webPath, file.name, (p) => {
          setImportProgress(Math.round(p * 0.5));
        });
        const { Capacitor } = await import('@capacitor/core');
        finalWebPath = Capacitor.convertFileSrc(finalUri);
      }

      // 2. Transcribe
      const transcript = await whisperService.transcribe(finalUri, (progress) => {
        const base = isVideo ? 50 : 0;
        const scale = isVideo ? 0.5 : 1;
        setImportProgress(base + Math.round(progress * scale));
      });

      onPlay(finalWebPath, 'shadowing', transcript);

    } catch (e: any) {
      console.error("Import/Convert failed", e);
      alert("Failed: " + e.message);
    } finally {
      setIsImporting(false);
      setImportProgress(0); // Reset progress after done
    }
  };

  // Hero Material is always the first one
  const heroMaterial = MATERIALS[0];

  return (
    <main className="flex-1 overflow-y-auto no-scrollbar scroll-smooth bg-black min-h-screen pt-[calc(env(safe-area-inset-top)+1rem)]">
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Removed empty sticky header */}

      <div className="px-6 space-y-10 pb-20">

        {/* Section 1: The Daily Spark */}
        <section>
          <div className="flex gap-2 mb-6 items-center animate-in slide-in-from-bottom-4 duration-500">
            <Sparkles className="w-6 h-6 text-indigo-400" />
            <h2 className="text-3xl font-medium text-white tracking-tight">Daily Spark</h2>
            <button
              onClick={onProfile}
              className="ml-auto p-2 text-zinc-600 hover:text-white transition-colors"
              aria-label="Settings"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>

          {/* Hero Card */}
          <div
            onClick={() => handleCardClick(heroMaterial)}
            className="relative w-full aspect-[1.9/1] rounded-2xl overflow-hidden group border border-zinc-800 shadow-2xl shadow-black cursor-pointer animate-in zoom-in-95 duration-700 delay-100 fill-mode-both"
          >
            {/* ... image ... */}
            <img
              src={heroMaterial.imageUrl}
              alt={heroMaterial.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 opacity-80"
            />
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 via-50% to-transparent" />

            {/* Star Button (Mock visual) */}
            <div className="absolute top-4 right-4 z-20">
              <button
                className="text-zinc-600 hover:text-yellow-400 transition-colors active:scale-90"
                onClick={(e) => { e.stopPropagation(); /* Toggle logic mock */ }}
              >
                <Star className={cn("w-6 h-6", heroMaterial.isStarred ? "fill-yellow-400 text-yellow-400" : "")} />
              </button>
            </div>

            {/* Content */}
            <div className="absolute bottom-0 left-0 w-full p-6">
              <div className="flex gap-2 mb-3">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium tracking-wide border",
                  "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                )}>
                  {heroMaterial.label?.text || 'Daily'}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700 text-xs font-medium tracking-wide">
                  Dec 18
                </span>
              </div>
              <h4 className="text-xl font-medium text-white tracking-tight leading-tight">{heroMaterial.title}</h4>
              <div className="flex items-center gap-4 text-sm text-zinc-400 mt-2">
                <span>{heroMaterial.duration}</span>
                {/* Progress Bar Visual */}
                <div className="flex items-center gap-1.5">
                  <span className="bg-indigo-500 w-8 h-1.5 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.5)]"></span>
                  <span className="bg-indigo-500 w-8 h-1.5 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.5)]"></span>
                  <span className="bg-zinc-700 w-8 h-1.5 rounded-full"></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Core Library */}
        <section>
          <div className="flex sticky z-30 top-24 pt-2 pb-2 items-center justify-between mb-6 bg-black/95 backdrop-blur-sm animate-in slide-in-from-bottom-8 duration-700 delay-200 fill-mode-both">
            <div className="flex items-center gap-3">
              <Library className="w-7 h-7 text-emerald-400" />
              <h2 className="text-3xl font-medium text-white tracking-tight">Core Library</h2>
            </div>

            <div className="flex gap-3 items-center">
              {/* Upload / Import Button with Circular Progress */}
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="w-12 h-12 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-700 transition-all shadow-sm shrink-0 active:scale-95"
              >
                {isImporting ? (
                  <CircularProgress progress={importProgress} />
                ) : (
                  <Upload className="w-5 h-5" />
                )}
              </button>

              {/* Filter Group */}
              <div
                className={cn(
                  "group flex flex-row-reverse items-center p-1.5 gap-2 h-12 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden transition-all duration-500 shadow-sm",
                  isMenuOpen ? "w-[150px] border-zinc-600" : "w-12 hover:border-zinc-700 hover:w-[150px]"
                )}
              >
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="flex shrink-0 w-9 h-9 items-center justify-center rounded-full text-zinc-400 hover:text-white"
                >
                  <Filter className={cn("w-5 h-5 transition-colors", isMenuOpen ? "text-white" : "")} />
                </button>

                {/* Separator & Other Buttons (Only visible when expanded effectively by width) */}
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ opacity: isMenuOpen ? 1 : undefined }}>
                  <div className="w-[1px] h-4 bg-zinc-800 shrink-0 mx-1" />

                  <button
                    onClick={() => setActiveFilter(activeFilter === 'reading' ? 'all' : 'reading')}
                    className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0", activeFilter === 'reading' ? "bg-zinc-800 text-indigo-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-indigo-400")}
                  >
                    <BookOpen className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setActiveFilter(activeFilter === 'starred' ? 'all' : 'starred')}
                    className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0", activeFilter === 'starred' ? "bg-zinc-800 text-yellow-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-yellow-400")}
                  >
                    <Star className={cn("w-4 h-4", activeFilter === 'starred' ? "fill-current" : "")} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 gap-4 pb-12">
            {displayMaterials.map((material) => (
              <div
                key={material.id}
                id={`card-${material.id}`}
                onClick={() => handleCardClick(material)}
                className="animate-card relative w-full h-80 rounded-2xl overflow-hidden group border border-zinc-800 hover:border-zinc-700 transition-all duration-500 fill-mode-both ease-out"
                style={{ transform: 'scale(0.95)', opacity: 0.8, filter: 'brightness(0.7)' }}
              >
                <img
                  src={material.imageUrl}
                  alt={material.title}
                  className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-50 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />

                {/* Star Button */}
                <div className="absolute top-3 right-3 z-10">
                  <button className="text-zinc-600 hover:text-yellow-400 transition-colors active:scale-90" onClick={(e) => { e.stopPropagation(); }}>
                    <Star className={cn("w-5 h-5", material.isStarred ? "fill-yellow-400 text-yellow-400" : "")} />
                  </button>
                </div>

                {/* Content */}
                <div className="absolute bottom-0 left-0 w-full p-5">
                  <div className="flex gap-2 mb-2">
                    {/* Mock Tags based on index/type */}
                    <span className="text-[10px] font-medium text-emerald-300 bg-emerald-500/20 border border-emerald-500/20 rounded px-2 py-0.5">精品长文</span>
                    <span className="text-[10px] font-medium text-blue-300 bg-blue-500/20 border border-blue-500/20 rounded px-2 py-0.5">科技新闻</span>
                  </div>
                  <h4 className="text-lg font-medium text-white tracking-tight leading-tight">{material.title}</h4>
                  <p className="line-clamp-1 text-sm text-zinc-400 mt-1">{material.duration}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>

      <Paywall
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSuccess={() => setShowPaywall(false)}
      />
    </main>
  );
}
