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
import { analytics } from "@/lib/analytics";

import { App as CapacitorApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';

type ViewState = 'home' | 'listening' | 'analysis' | 'shadowing' | 'profile';

function App() {
  const [activeView, setActiveView] = useState<ViewState>('home');
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | undefined>(undefined);
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptSegment[]>(defaultTranscript);
  const [currentMaterialId, setCurrentMaterialId] = useState<string>(''); // NEW STATE
  const [currentWaveformData, setCurrentWaveformData] = useState<number[][] | undefined>(undefined);

  // Ref to prevent double-click/event bubbling
  const lastPlayTime = useRef<number>(0);
  // Ref to prevent async init from overwriting user actions (CRITICAL FIX)
  const isUserActiveRef = useRef(false);

  // 🛡️ Strict Auth Gate: Block HomeView execution until auth check is done (success or fail)
  const [isAuthCheckComplete, setIsAuthCheckComplete] = useState(false);
  const hasLoggedRef = useRef(false); // 🔥 Prevent double login

  // 📊 Learning Progress Time Tracking
  const sessionStartTimeRef = useRef<number>(0);  // Material session start time
  const phaseStartTimeRef = useRef<number>(0);    // Current phase start time
  const currentPhaseRef = useRef<string>('');      // Current phase name
  const visitedPhasesRef = useRef<Set<string>>(new Set());  // Visited phases
  const furthestPhaseRef = useRef<string>('');     // Furthest phase reached

  const { isPlaying, currentTime, togglePlay, seek, audioRef, pause, play } = useAudio(currentSrc, activeView === 'listening');
  const { appUserID } = useRevenueCat();

  // 📊 Helper: Calculate duration in seconds
  const calculateDuration = (startTime: number): number => {
    if (startTime === 0) return 0;
    return Math.floor((Date.now() - startTime) / 1000);
  };

  // 📊 Helper: End current phase
  const endCurrentPhase = (completed: boolean = false) => {
    if (phaseStartTimeRef.current > 0 && currentPhaseRef.current && currentMaterialId) {
      const duration = calculateDuration(phaseStartTimeRef.current);

      analytics.track('phase_completed', {
        material_id: currentMaterialId,
        phase: currentPhaseRef.current,
        duration_seconds: duration,
        completed: completed,
        timestamp: new Date().toISOString()
      });

      phaseStartTimeRef.current = 0;
    }
  };

  // 📊 Helper: End material session
  const endMaterialSession = (completedShadowing: boolean = false) => {
    if (sessionStartTimeRef.current > 0 && currentMaterialId) {
      endCurrentPhase(false); // First end current phase

      const totalDuration = calculateDuration(sessionStartTimeRef.current);

      analytics.track('material_session_end', {
        material_id: currentMaterialId,
        total_duration_seconds: totalDuration,
        phases_visited: Array.from(visitedPhasesRef.current),
        furthest_phase: furthestPhaseRef.current,
        completed_shadowing: completedShadowing,
        timestamp: new Date().toISOString()
      });

      // Reset
      sessionStartTimeRef.current = 0;
      visitedPhasesRef.current.clear();
      furthestPhaseRef.current = '';
    }
  };

  // 1. 🔥 PARALLEL DATA LOADING (Independent of Auth)
  useEffect(() => {
    async function loadData() {
      if (isUserActiveRef.current) return;
      try {
        console.log('🚀 Parallel Load: Starting Data Fetch...');

        // Load Cache Immediately for Speed
        const cached = await getCachedTranscript();
        if (cached && !isUserActiveRef.current) {
          console.log('⚡ Cache Hit: Loaded transcript');
          setCurrentSrc(cached.url);
          setCurrentTranscript(cached.segments);
        }

        // Fetch Server Data in Background
        const data = await getLatestTranscript();
        if (data && data.segments.length > 0 && !isUserActiveRef.current) {
          console.log('🌐 Server Data Arrived');
          setCurrentSrc(prev => (prev ? prev : data.url));
          setCurrentTranscript(data.segments);
          saveTranscriptToCache(data);
        }
      } catch (err) {
        console.warn('Data load warning:', err);
      }
    }
    loadData();
  }, []);

  // 2. 🔐 SMART AUTH STRATEGY (Cache -> RC Wait -> Device Fallback)
  // This effect orchestrates the login race.
  useEffect(() => {
    async function initAuth() {
      if (hasLoggedRef.current) return;

      try {
        // A. ⚡ Try Cache First (0ms latency for existing users)
        const { value: cachedId } = await Preferences.get({ key: 'last_rc_id' });
        if (cachedId) {
          console.log('💾 Auth Cache Hit:', cachedId);
          hasLoggedRef.current = true; // Lock

          analytics.init();
          analytics.identify(cachedId);
          analytics.track('app_opened', { platform: 'capacitor', method: 'cache' });

          await silentLogin(cachedId);
          setIsAuthCheckComplete(true);
          return;
        }

        // B. ⏳ If no cache, start the "Race against Time"
        console.log('⏳ No auth cache. Waiting for RevenueCat...');

        // We set a trap: if RC doesn't reply in 2.5s, we proceed with Device ID.
        setTimeout(async () => {
          if (!hasLoggedRef.current) {
            console.warn('⏰ RC Timeout (2.5s). Fallback to Device ID.');
            try {
              const deviceInfo = await Device.getId();
              const deviceId = deviceInfo.identifier;

              hasLoggedRef.current = true; // Lock

              analytics.init();
              analytics.identify(deviceId);
              analytics.track('app_opened', { platform: 'capacitor', method: 'device_fallback' });

              await silentLogin(deviceId);
            } catch (e) {
              console.error('Fallback failed', e);
            } finally {
              setIsAuthCheckComplete(true);
            }
          }
        }, 2500);

      } catch (e) {
        console.error('Auth Init Error', e);
        setIsAuthCheckComplete(true);
      }
    }

    initAuth();
  }, []); // Run once on mount

  // 3. 📡 REVENUECAT LISTENER (The "Winner" of the race)
  useEffect(() => {
    if (appUserID && !hasLoggedRef.current) {
      console.log('💎 RevenueCat ID Ready:', appUserID);
      hasLoggedRef.current = true; // Lock

      analytics.init();
      analytics.identify(appUserID);
      analytics.track('app_opened', { platform: 'capacitor', method: 'revenuecat' });

      silentLogin(appUserID).then(() => {
        setIsAuthCheckComplete(true);
      });
    }
  }, [appUserID]); // Trigger when RC provides ID

  // 4. 🔄 SAFETY RE-FETCH (Ensure Content Loads)
  // If parallel fetch failed (e.g. fresh install + protected DB), retry after auth.
  useEffect(() => {
    if (isAuthCheckComplete && currentTranscript.length <= 1) {
      console.log('🔄 Auth Complete & No Data: Retrying fetch...');
      getLatestTranscript().then(data => {
        if (data && data.segments.length > 0) {
          console.log('✅ Safety Fetch Success');
          setCurrentSrc(prev => (prev ? prev : data.url));
          setCurrentTranscript(data.segments);
          saveTranscriptToCache(data);
        }
      });
    }
  }, [isAuthCheckComplete]);

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


  const handlePlay = async (
    audioUrl: string,
    targetView?: ViewState,
    newTranscript?: TranscriptSegment[],
    materialId?: string,
    waveformData?: number[][],
    title?: string,
    coverUrl?: string, // 🔥 新增：封面URL
    dataPromise?: Promise<any>  // 🔥 新增：预加载的Promise
  ) => {
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
      if (coverUrl) setCurrentCoverUrl(coverUrl);

      // 📊 Start new learning session
      sessionStartTimeRef.current = Date.now();
      phaseStartTimeRef.current = Date.now();
      currentPhaseRef.current = 'listening';
      visitedPhasesRef.current.clear();
      visitedPhasesRef.current.add('listening');
      furthestPhaseRef.current = 'listening';

      // 📊 Track phase started
      analytics.track('phase_started', {
        material_id: materialId,
        phase: 'listening',
        timestamp: new Date().toISOString()
      });

      // Analytics: View Material
      analytics.track('view_material', {
        material_id: materialId,
        material_title: title || 'Unknown',
        category: 'core_library'
      });

      // 🔥 Trigger Phase 1 Progress (Entered Listening)
      // updateUserProgress 内部会处理 free user 计数
      if (!targetView || targetView === 'listening') {
        updateUserProgress(materialId, { current_step: 1 });
      }
    }

    // Only update src if it's actually different (prevent audio reload)
    if (audioUrl !== currentSrc) {
      setCurrentSrc(audioUrl);
    }

    // 🔥 NEW: 预加载模式 - 立即切换页面，后台等待数据
    if (dataPromise) {
      console.log('🎬 Preload mode: switching view immediately, waiting for data in background');

      // 立即切换页面（让Hero动画开始）
      setActiveView(targetView || 'listening');

      // 后台等待数据
      try {
        const data = await dataPromise;
        if (data && data.segments && data.segments.length > 0) {
          console.log('✅ Preloaded data arrived:', data.segments.length, 'segments');
          setCurrentTranscript(data.segments);
          if (data.waveform_data) {
            setCurrentWaveformData(data.waveform_data);
          }
        } else {
          console.warn('⚠️ Preloaded data is empty or invalid');
        }
      } catch (error) {
        console.error('❌ Preload data failed:', error);
        // 失败也继续，不阻塞播放
      }

      // 🔥 CRITICAL FIX: 无论数据是否成功，都要调用play()
      // 否则会永远卡在0秒
      if (!targetView || targetView === 'listening') {
        play();
      }
      return;
    }

    // 🔥 FIX: 如果 transcript 为空但有 materialId，主动加载
    if ((!newTranscript || newTranscript.length === 0) && materialId) {
      console.warn('⚠️ Transcript missing or empty for material:', materialId, '- fetching from server...');
      try {
        const fullData = await getTranscriptById(materialId);
        if (fullData && fullData.segments && fullData.segments.length > 0) {
          console.log('✅ Loaded transcript from server:', fullData.segments.length, 'segments');
          setCurrentTranscript(fullData.segments);
          setTimeout(() => setActiveView(targetView || 'listening'), 0);

          // Auto-play if listening view
          if (!targetView || targetView === 'listening') {
            play();
          }
          return;
        } else {
          console.warn('⚠️ Server returned empty transcript for material:', materialId);
        }
      } catch (error: any) {
        console.error('❌ Failed to load transcript:', error);

        // 🔥 FIX: 如果是404错误，说明材料不存在，阻止播放
        if (error.status === 404) {
          console.error('❌ Material not found on server:', materialId);
          // 恢复到之前的状态
          setCurrentSrc(currentSrc); // 保持原有音频
          // 提示用户并返回Home
          alert('该材料不存在或已被删除');
          setActiveView('home');
          return;
        }
        // 其他错误(网络异常等)继续执行原有逻辑，不阻塞播放
      }
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
          "w-full max-w-md md:max-w-2xl lg:max-w-3xl bg-black md:bg-zinc-900/50 md:backdrop-blur-xl md:border md:border-zinc-800 md:rounded-3xl h-[100dvh] overflow-hidden relative shadow-2xl flex flex-col transition-all duration-500",
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
                // 📊 End phase and session
                endCurrentPhase(false);
                endMaterialSession(false);
                setActiveView('home');
              }}
              onNextPhase={() => {
                pause();
                // 📊 End Listening phase (completed)
                endCurrentPhase(true);

                // 📊 Start Analysis phase
                phaseStartTimeRef.current = Date.now();
                currentPhaseRef.current = 'analysis';
                visitedPhasesRef.current.add('analysis');
                furthestPhaseRef.current = 'analysis';

                analytics.track('phase_started', {
                  material_id: currentMaterialId,
                  phase: 'analysis',
                  timestamp: new Date().toISOString()
                });

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
              waveformData={currentWaveformData}
              coverUrl={currentCoverUrl} // 🔥 Pass down
            />
          )}

          {activeView === 'analysis' && (
            <AnalysisView
              onBack={() => {
                // 📊 End Analysis phase (not completed)
                endCurrentPhase(false);

                // 📊 Restart Listening phase
                phaseStartTimeRef.current = Date.now();
                currentPhaseRef.current = 'listening';

                analytics.track('phase_started', {
                  material_id: currentMaterialId,
                  phase: 'listening',
                  timestamp: new Date().toISOString()
                });

                setActiveView('listening');
              }}
              onNextPhase={() => {
                pause();
                // 📊 End Analysis phase (completed)
                endCurrentPhase(true);

                // 📊 Start Shadowing phase
                phaseStartTimeRef.current = Date.now();
                currentPhaseRef.current = 'shadowing';
                visitedPhasesRef.current.add('shadowing');
                furthestPhaseRef.current = 'shadowing';

                analytics.track('phase_started', {
                  material_id: currentMaterialId,
                  phase: 'shadowing',
                  timestamp: new Date().toISOString()
                });

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
              onBack={() => {
                // 📊 End Shadowing phase and session (not completed)
                endCurrentPhase(false);
                endMaterialSession(false);
                setActiveView('analysis');
              }} // Back to Analysis (Top Left)
              onHome={() => {
                // 📊 End Shadowing phase and session (not completed)
                endCurrentPhase(false);
                endMaterialSession(false);
                setActiveView('home');
              }}     // Close to Home (Top Right)
              audioSrc={currentSrc}
              transcript={currentTranscript}
              materialId={currentMaterialId} // NEW: Pass Material ID for Phase 3 Tracking
              waveformData={currentWaveformData}
              onRecordingComplete={() => {
                // 📊 End Shadowing phase and session (completed)
                endCurrentPhase(true);
                endMaterialSession(true);
              }}
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
