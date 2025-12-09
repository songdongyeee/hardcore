import { Award, ChevronRight } from "lucide-react";

interface HomeViewProps {
  onNavigate: (view: 'listening') => void;
}

export function HomeView({ onNavigate }: HomeViewProps) {
  return (
    <main className="flex-1 overflow-y-auto no-scrollbar scroll-smooth pt-20 pr-4 pb-10 pl-4 space-y-8">
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
      <div className="space-y-6">
        {/* Card 1: In Progress */}
        <div 
          onClick={() => onNavigate('listening')} 
          className="group relative aspect-[4/5] w-full rounded-2xl overflow-hidden cursor-pointer border border-zinc-800 hover:border-zinc-600 transition-all duration-300" 
          style={{ animation: "enter-blur-slide 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.2s both" }}
        >
          <img 
            src="https://images.unsplash.com/photo-1556761175-5973dc0f32e7?q=80&w=1000&auto=format&fit=crop" 
            className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700 grayscale hover:grayscale-0" 
            alt="Steve Jobs" 
          />
          <div className="bg-gradient-to-t from-black via-black/40 to-transparent absolute top-0 right-0 bottom-0 left-0"></div>
          
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-medium tracking-wide">L4 HARD</span>
              <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700 text-xs font-medium tracking-wide">14:02</span>
            </div>
            <h2 className="text-2xl font-semibold text-white tracking-tight leading-snug mb-2">Steve Jobs: Stanford Commencement Speech</h2>
            
            {/* Progress Bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1 bg-zinc-700/50 rounded-full overflow-hidden backdrop-blur-sm">
                <div className="h-full bg-white w-[45%]"></div>
              </div>
              <span className="text-xs text-zinc-300 font-medium">Phase 1</span>
            </div>
          </div>
        </div>

        {/* Card 2: New */}
        <div 
          className="group relative aspect-[4/5] w-full rounded-2xl overflow-hidden cursor-pointer border border-zinc-800 hover:border-zinc-600 transition-all duration-300" 
          style={{ animation: "enter-blur-slide 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.3s both" }}
        >
          <img 
            src="https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/917d6f93-fb36-439a-8c48-884b67b35381_1600w.jpg" 
            className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-700 grayscale hover:grayscale-0" 
            alt="News" 
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
          
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium tracking-wide">NEW</span>
              <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700 text-xs font-medium tracking-wide">05:30</span>
            </div>
            <h2 className="text-2xl font-semibold text-white tracking-tight leading-snug mb-2">BBC News: Global Economics Update</h2>
            <p className="text-sm text-zinc-400 line-clamp-2">Understanding market volatility and the impact on international trade agreements.</p>
          </div>
        </div>

        {/* Card 3: Mastered */}
        <div 
          className="group relative h-40 w-full rounded-2xl overflow-hidden cursor-pointer border border-amber-900/30 hover:border-amber-700/50 transition-all duration-300" 
          style={{ animation: "enter-blur-slide 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.4s both" }}
        >
             <div className="absolute inset-0 bg-amber-950/10"></div>
             <img 
               src="https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/4734259a-bad7-422f-981e-ce01e79184f2_1600w.jpg" 
               className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay grayscale" 
               alt="Mastered" 
            />
            
            <div className="absolute inset-0 flex items-center justify-between p-6">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Award className="w-4 h-4 text-amber-500" />
                        <span className="text-amber-500 text-xs font-semibold tracking-widest uppercase">Mastered</span>
                    </div>
                    <h2 className="text-lg font-semibold text-zinc-300 tracking-tight">The Feynman Technique</h2>
                </div>
                <ChevronRight className="text-zinc-600" />
            </div>
        </div>
      </div>
      
      <div className="h-10"></div>
    </main>
  );
}
