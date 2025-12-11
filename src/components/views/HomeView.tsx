import { useRef, useState, useEffect } from "react";
import { MaterialCard, type Material } from "@/components/MaterialCard";

interface HomeViewProps {
  onPlay: (audioUrl: string) => void;
}

const MATERIALS: Material[] = [
  {
    id: '1',
    title: 'Steve Jobs: Stanford Commencement Speech',
    imageUrl: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?q=80&w=1000&auto=format&fit=crop',
    duration: '14:02',
    label: { text: 'L4 HARD', type: 'hard' },
    progress: 45,
    audioUrl: '/演讲音频.m4a'
  },
  {
    id: '2',
    title: 'BBC News: Global Economics Update',
    subtitle: 'Understanding market volatility and the impact on international trade agreements.',
    imageUrl: 'https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/917d6f93-fb36-439a-8c48-884b67b35381_1600w.jpg',
    duration: '05:30',
    label: { text: 'NEW', type: 'new' },
    audioUrl: '/演讲音频.m4a' // Placeholder
  },
  {
    id: '3',
    title: 'The Feynman Technique',
    imageUrl: 'https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/4734259a-bad7-422f-981e-ce01e79184f2_1600w.jpg',
    label: { text: 'MASTERED', type: 'mastered' },
    audioUrl: '/演讲音频.m4a' // Placeholder
  }
];

export function HomeView({ onPlay }: HomeViewProps) {
  const [activeId, setActiveId] = useState<string>('1');
  const observerRefs = useRef<(HTMLDivElement | null)[]>([]);

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
      <div className="px-2" style={{ animation: "enter-blur-slide 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s both" }}>
        <h1 className="text-3xl font-semibold tracking-tight text-white mb-1">Selection Hub</h1>
        <p className="text-sm text-zinc-500">Pick your pain. Start the grind.</p>
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
              onClick={() => onPlay(material.audioUrl)}
            />
          </div>
        ))}
      </div>
    </main>
  );
}

