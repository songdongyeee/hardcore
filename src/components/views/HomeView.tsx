import { useRef, useState, useEffect } from "react";
import { MaterialCard, type Material } from "@/components/MaterialCard";
import { User } from "lucide-react";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { Paywall } from "@/components/Paywall";
import { Preferences } from '@capacitor/preferences';

interface HomeViewProps {
  onPlay: (audioUrl: string, targetView?: 'listening' | 'shadowing') => void;
  onProfile: () => void;
}

const MATERIALS: Material[] = [
  {
    id: '1',
    title: 'Steve Jobs: Stanford Commencement Speech',
    imageUrl: '/images/steve_jobs.jpg',
    duration: '14:02',
    label: { text: 'L4 HARD', type: 'hard' },
    progress: 45,
    audioUrl: '/演讲音频.m4a'
  },
  {
    id: '2',
    title: 'BBC News: Global Economics Update',
    subtitle: 'Understanding market volatility and the impact on international trade agreements.',
    imageUrl: '/images/bbc_news.jpg',
    duration: '05:30',
    label: { text: 'NEW', type: 'new' },
    audioUrl: '/演讲音频.m4a' // Placeholder
  },
  {
    id: '3',
    title: 'The Feynman Technique',
    imageUrl: '/images/feynman.jpg',
    label: { text: 'MASTERED', type: 'mastered' },
    audioUrl: '/演讲音频.m4a' // Placeholder
  }
];

export function HomeView({ onPlay, onProfile }: HomeViewProps) {
  const [activeId, setActiveId] = useState<string>('1');
  const [showPaywall, setShowPaywall] = useState(false);
  const observerRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { isVip } = useRevenueCat();
  const { checkAccess } = useUsageLimit(isVip);

  const handleCardClick = async (material: Material) => {
    // Logic: Free User can only access the first article (id '1')
    if (!isVip && material.id !== '1') {
      setShowPaywall(true);
      return;
    }

    // Optional: Keep usage tracking if needed, or bypass.
    // Let's assume usage limit is superseded by this "Free/Pro" content split.
    const access = await checkAccess(material.id); // Validates daily limit too?
    if (access.allowed) {
      // CHECK FOR EXISTING SESSION
      try {
        const sessionKey = `shadowing_session_${material.audioUrl.replace(/[^a-z0-9]/gi, '_')}`;
        const { value } = await Preferences.get({ key: sessionKey });
        if (value) {
          const session = JSON.parse(value);
          if (session.status === 'review') {
            // Jump directly to Shadowing
            onPlay(material.audioUrl, 'shadowing');
            return;
          }
        }
      } catch (e) { console.error("Session Check Failed", e); }

      onPlay(material.audioUrl);
    } else {
      // If daily limit also blocks?
      setShowPaywall(true);
    }
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Use dataset id to identify the card
            const id = (entry.target as HTMLElement).dataset.id;
            if (id) setActiveId(id);
          }
        });
      },
      {
        root: null,
        // Trigger when the element touches the middle ~50% of the screen
        rootMargin: '-25% 0px -25% 0px',
        threshold: 0.4
      }
    );

    observerRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <main className="flex-1 overflow-y-auto no-scrollbar scroll-smooth pt-[calc(1.5rem+env(safe-area-inset-top))] pr-4 pb-10 pl-4 space-y-8">
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes enter-blur-slide {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); filter: blur(10px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
      `}</style>

      {/* Section Title */}
      <div className="px-2 cursor-pointer flex items-center justify-between" style={{ animation: "enter-blur-slide 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s both" }}>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white mb-1">Selection Hub</h1>
          <p className="text-sm text-zinc-500">Pick your pain. Start the grind.</p>
        </div>
        <button onClick={onProfile} className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition">
          <User className="w-6 h-6" />
        </button>
      </div>

      {/* Card List */}
      <div className="space-y-6 pb-20"> {/* pb-20 gives space at bottom to scroll last item to center */}
        {MATERIALS.map((material, index) => (
          <div
            key={material.id}
            data-id={material.id}
            ref={el => { if (el) observerRefs.current[index] = el; }}
            style={{ animation: `enter-blur-slide 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) ${0.2 + index * 0.1}s both` }}
          >
            <MaterialCard
              material={material}
              isActive={activeId === material.id}
              onClick={() => handleCardClick(material)}
            />
          </div>
        ))}
      </div>

      <Paywall
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSuccess={() => setShowPaywall(false)}
      />
    </main >
  );
}
