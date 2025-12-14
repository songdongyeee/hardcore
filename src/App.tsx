import { useState } from 'react';
import { cn } from "@/lib/utils";
import { useAudio } from "@/hooks/useAudio";
import { Header } from "@/components/Header";
import { HomeView } from "@/components/views/HomeView";
import { ListeningView } from "@/components/views/ListeningView";
import { AnalysisView } from "@/components/views/AnalysisView";
import { ShadowingView } from "@/components/views/ShadowingView";
import { ProfileView } from "@/components/views/ProfileView";

type ViewState = 'home' | 'listening' | 'analysis' | 'shadowing' | 'profile';

function App() {
  const [activeView, setActiveView] = useState<ViewState>('home');
  const [currentSrc, setCurrentSrc] = useState<string>('/演讲音频.m4a');
  // Only enable audio when in 'listening' view
  const { isPlaying, currentTime, togglePlay, seek, audioRef, pause, play } = useAudio(currentSrc, activeView === 'listening');

  const handlePlay = (audioUrl: string) => {
    if (audioUrl === currentSrc) {
      play();
    }
    setCurrentSrc(audioUrl);
    setActiveView('listening');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 font-sans text-zinc-200 p-0 md:p-6 lg:p-12 overflow-hidden selection:bg-indigo-500/30 selection:text-indigo-200">

      {/* App Container */}
      <div
        id="app-container"
        className={cn(
          "w-full max-w-md bg-black md:bg-zinc-900/50 md:backdrop-blur-xl md:border md:border-zinc-800 md:rounded-3xl h-[100dvh] md:h-[850px] overflow-hidden relative shadow-2xl flex flex-col transition-all duration-500",
          activeView !== 'home' && "md:bg-black"
        )}
      >
        <Header
          onNavigateHome={() => {
            pause();
            setActiveView('home');
          }}
          className={activeView === 'home' ? "" : "hidden"}
        />

        {/* View Manager */}
        <div className="relative w-full h-full flex-1 flex flex-col">
          <HomeView onPlay={handlePlay} onProfile={() => setActiveView('profile')} />

          {activeView === 'listening' && (
            <ListeningView
              onBack={() => {
                pause();
                setActiveView('home');
              }}
              onNextPhase={() => {
                pause();
                setActiveView('analysis');
              }}
              audioRef={audioRef}
              currentTime={currentTime}
              isPlaying={isPlaying}
              togglePlay={togglePlay}
              seek={seek}
            />
          )}

          {activeView === 'analysis' && (
            <AnalysisView
              onBack={() => setActiveView('listening')}
              onNextPhase={() => {
                pause();
                setActiveView('shadowing');
              }}
              audioRef={audioRef}
              currentTime={currentTime}
              isPlaying={isPlaying}
              seek={seek}
            />
          )}

          {activeView === 'shadowing' && (
            <ShadowingView
              onBack={() => setActiveView('analysis')} // Back to Analysis (Top Left)
              onHome={() => setActiveView('home')}     // Close to Home (Top Right)
              audioSrc={currentSrc}
            />
          )}

          {activeView === 'profile' && (
            <ProfileView onBack={() => setActiveView('home')} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
