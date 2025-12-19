import { useState, useEffect } from "react";
import { MaterialCard, type Material } from "@/components/MaterialCard";
import { Menu, Sparkles, Upload, Library, BookOpen, Star, Filter, X } from "lucide-react";
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
  const [userMaterials, setUserMaterials] = useState<Material[]>([]);

  const { isVip } = useRevenueCat();
  const { checkAccess } = useUsageLimit(isVip);

  // Filter Logic
  const displayMaterials = [
    ...userMaterials,
    ...(activeFilter === 'starred'
      ? MATERIALS.filter(m => m.isStarred)
      : MATERIALS.slice(1))
  ];

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
  }, [activeFilter, userMaterials]); // added userMaterials

  const handleCardClick = async (material: Material) => {
    const isUserUpload = material.id.startsWith('user-');

    // Logic: Free User can only access the first article (id '1') and their own uploads
    if (!isVip && material.id !== '1' && !isUserUpload) {
      setShowPaywall(true);
      return;
    }

    if (!isUserUpload) {
      const access = await checkAccess(material.id);
      if (access.allowed) {
        onPlay(material.audioUrl);
      } else {
        setShowPaywall(true);
      }
    } else {
      // For user uploads, pass the transcript if we have it
      // Start from Phase 1 (Listening), not Shadowing
      onPlay(material.audioUrl, 'listening', material.transcript);
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
      // We pass finalWebPath because fetch() (used in whisperService) needs a http/capacitor URL, not file://
      const response = await fetch(finalWebPath);
      const blob = await response.blob();
      const fileName = `upload_${Date.now()}.mp3`; // Generate a filename

      const transcript = await whisperService.transcribe(blob, fileName, (progress) => {
        const base = isVideo ? 50 : 0;
        const scale = isVideo ? 0.5 : 1;
        setImportProgress(base + Math.round(progress * scale));
      });

      // 3. Add to Core Library (Home View)
      const newMaterial: Material = {
        id: `user-${Date.now()}`,
        title: file.name,
        subtitle: 'Just uploaded',
        imageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop',
        duration: '00:00', // placeholder
        label: { text: 'My Upload', type: 'new' },
        audioUrl: finalWebPath,
        transcript: transcript
      };

      setUserMaterials(prev => [newMaterial, ...prev]);
      alert("【版本 2.0】上传成功！已添加到列表顶部");

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

  const handleDelete = async (id: string) => {
    if (confirm("Delete this material?")) {
      setUserMaterials(prev => prev.filter(m => m.id !== id));
    }
  };

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
            className="relative w-full aspect-[11/9] rounded-2xl overflow-hidden group border border-zinc-800 shadow-2xl shadow-black cursor-pointer animate-in zoom-in-95 duration-700 delay-100 fill-mode-both"
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
              <div className="flex gap-2 mb-2 gap-x-2 gap-y-2">
                <span className={cn(
                  "text-xs font-medium border rounded pt-0.5 pr-2 pb-0.5 pl-2",
                  "text-indigo-300 bg-indigo-500/20 border-indigo-500/20"
                )}>
                  {heroMaterial.label?.text || 'Daily'}
                </span>
                <span className="text-xs font-medium text-zinc-300 bg-zinc-500/20 border-zinc-500/20 border rounded pt-0.5 pr-2 pb-0.5 pl-2">
                  12月17日
                </span>
              </div>
              <h4 className="text-2xl font-medium text-white tracking-tight leading-tight">{heroMaterial.title}</h4>
              <div className="flex items-center gap-4 text-base text-zinc-400 mt-2">
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
          <div className="flex sticky z-30 top-0 pt-[env(safe-area-inset-top)] pb-2 items-center justify-between mb-2 bg-black/80 backdrop-blur-xl animate-in slide-in-from-bottom-8 duration-700 delay-200 fill-mode-both">
            <div className="flex items-center gap-3 overflow-hidden">
              <Library className={cn("shrink-0 text-emerald-400", isMenuOpen ? "w-6 h-6" : "w-7 h-7")} />
              <h2 className={cn(
                "font-medium text-white tracking-tight whitespace-nowrap",
                isMenuOpen ? "text-xl" : "text-3xl"
              )}>
                Core Library
              </h2>
            </div>

            <div className="flex gap-3 items-center">
              {/* Upload / Import Button with Circular Progress */}
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-700 shadow-sm shrink-0 active:scale-95"
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
                  "group flex flex-row-reverse items-center p-1 gap-1 h-11 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden shadow-sm",
                  isMenuOpen ? "w-[140px] border-zinc-600" : "w-11 hover:border-zinc-700"
                )}
              >
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="flex shrink-0 w-9 h-9 items-center justify-center rounded-full text-zinc-400 hover:text-white"
                >
                  {isMenuOpen ? (
                    <X className="w-5 h-5 text-zinc-500 hover:text-zinc-300 transition-colors" />
                  ) : (
                    <Filter className="w-5 h-5 transition-colors" />
                  )}
                </button>

                {/* Separator & Other Buttons */}
                <div className="flex items-center gap-1" style={{ display: isMenuOpen ? 'flex' : 'none' }}>
                  <div className="w-[1px] h-5 bg-zinc-800 shrink-0 mx-0.5" />

                  <button
                    onClick={() => setActiveFilter(activeFilter === 'reading' ? 'all' : 'reading')}
                    className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0", activeFilter === 'reading' ? "bg-zinc-800 text-indigo-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-indigo-400")}
                  >
                    <BookOpen className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setActiveFilter(activeFilter === 'starred' ? 'all' : 'starred')}
                    className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0", activeFilter === 'starred' ? "bg-zinc-800 text-yellow-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-yellow-400")}
                  >
                    <Star className={cn("w-5 h-5", activeFilter === 'starred' ? "fill-current" : "")} />
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
                className="animate-card"
              >
                <MaterialCard
                  material={material}
                  isActive={false} // ignored by grid variant
                  variant="grid"
                  onClick={() => handleCardClick(material)}
                  onLongPress={material.id.startsWith('user-') ? () => handleDelete(material.id) : undefined}
                />
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
