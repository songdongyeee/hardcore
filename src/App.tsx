import { useState, useEffect, useRef } from 'react';
import { cn } from "@/lib/utils";
import { useAudio } from "@/hooks/useAudio";
import { transcript as defaultTranscript } from "@/data/transcript";
import type { TranscriptSegment } from "@/data/transcript";
import { Header } from "@/components/Header";
import { HomeView } from "@/components/views/HomeView";
import { ListeningView } from "@/components/views/ListeningView";
import { AnalysisView } from "@/components/views/AnalysisView";
import { ShadowingView } from "@/components/views/ShadowingView";
import { ProfileView } from "@/components/views/ProfileView";

import { getLatestTranscript, getCachedTranscript, saveTranscriptToCache, silentLogin, updateUserProgress, getTranscriptById } from "@/lib/api";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { Device } from "@capacitor/device";
import { App as CapacitorApp } from '@capacitor/app';

type ViewState = 'home' | 'listening' | 'analysis' | 'shadowing' | 'profile';

function App() {
  const [activeView, setActiveView] = useState<ViewState>('home');
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptSegment[]>(defaultTranscript);
  const [currentMaterialId, setCurrentMaterialId] = useState<string>(''); // NEW STATE
  const [currentWaveformData, setCurrentWaveformData] = useState<number[][] | undefined>(undefined);

  // Ref to prevent double-click/event bubbling
  const lastPlayTime = useRef<number>(0);
  // Ref to prevent async init from overwriting user actions (CRITICAL FIX)
  const isUserActiveRef = useRef(false);

  // 🛡️ Strict Auth Gate: Block HomeView execution until auth check is done (success or fail)
  const [isAuthCheckComplete, setIsAuthCheckComplete] = useState(false);

  const { isPlaying, currentTime, togglePlay, seek, audioRef, pause, play } = useAudio(currentSrc, activeView === 'listening');
  const { appUserID, isReady: isRcReady } = useRevenueCat();

  // 1. Silent Login & Initial Load
  useEffect(() => {
    async function init() {
      try {
        // 1. Get ID for Login - Use RevenueCat ID (maintains subscription continuity)
        let loginId = appUserID;
        if (!loginId) {
          // Fallback to device ID only if RevenueCat not ready
          const deviceId = await Device.getId();
          loginId = deviceId.identifier;
        }

        console.log('[Auth] Login ID:', loginId);
        console.log('[Auth] Source:', appUserID ? 'RevenueCat' : 'Device');

        if (loginId) {
          // Single attempt - event listeners will handle retry on network recovery
          const success = await silentLogin(loginId);
          if (success) {
            console.log('✅ Login successful');
          } else {
            console.warn('⚠️ Login failed. Will retry when network becomes available or app returns to foreground.');
          }
        }

        // 2. Initial Data Loading (SKIP if user already active)
        if (isUserActiveRef.current) {
          console.log('Skipping init data load: User is active');
          return;
        }

        const cached = await getCachedTranscript();
        // Double check active state after await
        if (cached && !isUserActiveRef.current) {
          setCurrentSrc(cached.url);
          setCurrentTranscript(cached.segments);
        }

        const data = await getLatestTranscript();
        // Double check active state after await
        if (data && data.segments.length > 0 && !isUserActiveRef.current) {
          // Double check audioSrc state just in case
          setCurrentSrc(prev => {
            if (prev && prev !== '') return prev;
            return data.url;
          });
          setCurrentTranscript(data.segments);
          saveTranscriptToCache(data);
        }
      } catch (error) {
        console.error('[App] Init failed:', error);
      } finally {
        // 🛡️ Release the gate: Authentication check is legally complete (success or fail)
        console.log('🛡️ Auth Gate Released');
        setIsAuthCheckComplete(true);
      }
    }

    init();
  }, [appUserID, isRcReady]);

  // Debug: Track transcript changes
  useEffect(() => {
    console.log('📝 currentTranscript changed:', currentTranscript.length, 'segments');
  }, [currentTranscript]);

  // Deep Link Listener (Custom Scheme + Universal Links)
  useEffect(() => {
    const listener = CapacitorApp.addListener('appUrlOpen', async (data) => {
      console.log('🔗 Deep link received:', data.url);

      const url = new URL(data.url);

      // Handle /listening with ID
      if (url.pathname.includes('/listening')) {
        const materialId = url.searchParams.get('id');
        if (materialId) {
          const transcript = await getTranscriptById(materialId);
          if (transcript) {
            handlePlay(transcript.url, 'listening', transcript.segments, transcript.id);
          }
        }
      }
      // Handle /profile
      else if (url.pathname.includes('/profile')) {
        setActiveView('profile');
      }
      // Handle /home
      else if (url.pathname.includes('/home')) {
        setActiveView('home');
      }
    });

    return () => {
      listener.then(l => l.remove());
    };
  }, []); // Empty deps - listener uses latest handlePlay via closure


  const handlePlay = (audioUrl: string, targetView?: ViewState, newTranscript?: TranscriptSegment[], materialId?: string, waveformData?: number[][]) => {
    const now = Date.now();
    // Debounce: Ignore if called within 500ms (prevent double clicks causing audio restart)
    if (now - lastPlayTime.current < 500 && audioUrl === currentSrc) {
      console.log('🚫 Debounced handlePlay call');
      // Still ensure view is correct just in case
      if (targetView && activeView !== targetView) setActiveView(targetView);
      return;
    }
    lastPlayTime.current = now;
    isUserActiveRef.current = true; // Mark user as active, stopping any pending init overwrites

    console.log('🎬 handlePlay called:', { audioUrl, targetView, transcriptItems: newTranscript?.length || 0, currentTranscriptItems: currentTranscript.length, materialId });

    // Set Material ID and Trigger Progress
    if (materialId) {
      setCurrentMaterialId(materialId);
      setCurrentWaveformData(waveformData);
      // 🔥 Trigger Phase 1 Progress (Entered Listening)
      if (!targetView || targetView === 'listening') {
        updateUserProgress(materialId, { current_step: 1 });
      }
    }

    // Only update src if it's actually different (prevent audio reload)
    if (audioUrl !== currentSrc) {
      setCurrentSrc(audioUrl);
    }

    if (newTranscript && newTranscript.length > 0) {
      console.log('✅ Setting new transcript:', newTranscript.length, 'segments');
      setCurrentTranscript(newTranscript);
      // Delay view change to ensure transcript updates first
      setTimeout(() => setActiveView(targetView || 'listening'), 0);
    } else if (audioUrl !== currentSrc && audioUrl === '/演讲音频.m4a') {
      // Only reset to default if switching to bundled material AND source actually changed
      console.log('🔄 Resetting to default transcript');
      setCurrentTranscript(defaultTranscript);
      setTimeout(() => setActiveView(targetView || 'listening'), 0);
    } else {
      // Defensive: If source is same, NEVER reset transcript to empty/default
      if (audioUrl === currentSrc && currentTranscript.length > 1) {
        console.log('🛡️ Defensive: Maintaining current transcript');
      }
      console.log('⚠️ Keeping current transcript:', currentTranscript.length, 'segments');
      setActiveView(targetView || 'listening');
    }

    // Auto-play if same source and listening view
    if (audioUrl === currentSrc && (!targetView || targetView === 'listening')) {
      play();
    }
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
          <HomeView
            onPlay={handlePlay}
            onProfile={() => setActiveView('profile')}
            isActive={activeView === 'home'}
            isAuthCheckComplete={isAuthCheckComplete}
          />

          {activeView === 'listening' && (
            <ListeningView
              onBack={() => {
                pause();
                setActiveView('home');
              }}
              onNextPhase={() => {
                pause();
                // 🔥 Trigger Phase 2 Progress (Entered Analysis)
                if (currentMaterialId) {
                  updateUserProgress(currentMaterialId, { current_step: 2 });
                }
                setActiveView('analysis');
              }}
              audioRef={audioRef}
              currentTime={currentTime}
              isPlaying={isPlaying}
              togglePlay={togglePlay}
              seek={seek}
              transcript={currentTranscript}
            />
          )}

          {activeView === 'analysis' && (
            <AnalysisView
              onBack={() => setActiveView('listening')}
              onNextPhase={() => {
                pause();
                // 🔥 Trigger Phase 3 Progress (Entered Shadowing)
                if (currentMaterialId) {
                  updateUserProgress(currentMaterialId, { current_step: 3 });
                }
                setActiveView('shadowing');
              }}
              audioRef={audioRef}
              currentTime={currentTime}
              isPlaying={isPlaying}
              seek={seek}
              transcript={currentTranscript} // PASS DATA
            />
          )}

          {activeView === 'shadowing' && (
            <ShadowingView
              onBack={() => setActiveView('analysis')} // Back to Analysis (Top Left)
              onHome={() => setActiveView('home')}     // Close to Home (Top Right)
              audioSrc={currentSrc}
              transcript={currentTranscript}
              materialId={currentMaterialId} // NEW: Pass Material ID for Phase 3 Tracking
              waveformData={currentWaveformData}
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
