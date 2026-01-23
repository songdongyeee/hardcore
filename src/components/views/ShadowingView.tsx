import { ChevronLeft, X, Play, Pause, RotateCcw, Ear, EarOff, Mic, Eye, EyeOff, Download } from "lucide-react";
// import { transcript } from "@/data/transcript"; // REMOVED STATIC IMPORT
import type { TranscriptSegment } from "@/data/transcript";
import { useState, useRef, useEffect } from "react";
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { cn } from "@/lib/utils";
import WaveSurfer from "wavesurfer.js";
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { pb, updateUserProgress } from '@/lib/api';
import { getCachedWaveform, cacheWaveform } from '@/lib/waveformCache';
import { analytics } from '@/lib/analytics';

import { Paywall } from "@/components/Paywall";

const SETTINGS_KEY = 'shadowing_settings_v1';

// --- VISUAL CONSTANTS ---
const WAVE_HEIGHT = 160;
const PX_PER_SEC = 100;  // High quality (segmented rendering keeps canvas small)
const SEGMENT_DURATION = 60; // Render 60 seconds at a time
const PEAKS_PER_SEC = 30; // Backend generates 30 peaks/second (consistent with batch_process.js)

interface ShadowingViewProps {
  onBack: () => void;
  onHome: () => void;
  audioSrc: string;
  transcript: TranscriptSegment[]; // Added Prop
  materialId?: string; // Added Prop
  waveformData?: number[][]; // Waveform visualization data [[min, max], ...]
  onRecordingComplete?: () => void; // 📊 Learning progress callback
}

type ShadowingStatus = 'idle' | 'preparing' | 'recording' | 'review';

export function ShadowingView({ onBack, onHome, audioSrc, transcript, materialId, waveformData, onRecordingComplete }: ShadowingViewProps) {
  // UNIQUE SESSION KEY PER AUDIO FILE
  const sessionKey = `shadowing_session_${audioSrc.replace(/[^a-z0-9]/gi, '_')}`;

  // --- State Machine ---
  const [status, setStatus] = useState<ShadowingStatus>('idle');

  // Paywall Logic
  const [showPaywall, setShowPaywall] = useState(false);

  // --- Cloze State ---
  // Default to 'hidden' (100% hidden)
  type ClozeMode = 'hidden' | 'partial' | 'visible';
  const [clozeMode, setClozeMode] = useState<ClozeMode>('hidden');
  const [hiddenIndices, setHiddenIndices] = useState<Set<string>>(new Set());

  // Logic: Hidden -> Partial (70%) -> Visible -> Hidden
  const toggleCloze = () => {
    setClozeMode(prev => {
      if (prev === 'hidden') return 'partial';
      if (prev === 'partial') return 'visible';
      return 'hidden';
    });
  };

  // Generate random indices when switching to 'partial'
  useEffect(() => {
    if (clozeMode === 'partial') {
      const indices = new Set<string>();
      transcript.forEach((seg, sIdx) => {
        seg.words?.forEach((word, wIdx) => {
          // Only hide actual words (any language), not punctuation
          const isRealWord = /\p{L}|\p{N}/u.test(word.text);
          // 70% chance to hide
          if (isRealWord && Math.random() < 0.7) {
            indices.add(`${sIdx}-${wIdx}`);
          }
        });
      });
      setHiddenIndices(indices);
    } else {
      setHiddenIndices(new Set()); // Clear memory when not needed
    }
  }, [clozeMode, transcript]);

  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const isPlayingMasterRef = useRef(false); // Ref for Loop Sync

  // Mixer State
  const [isSourceMuted, setIsSourceMuted] = useState(true); // Default OFF (Ear)
  const [isUserMuted, setIsUserMuted] = useState(false);   // Default ON (Mic)

  // Audio Data
  const [duration, setDuration] = useState(0); // Source Duration
  const [userDuration, setUserDuration] = useState(0); // User Duration
  const [recordedBase64, setRecordedBase64] = useState<string | null>(null);

  // Segmented Waveform State
  const [fullPeaks, setFullPeaks] = useState<number[] | null>(null);
  const [segmentStart, setSegmentStart] = useState(0); // Start time of current segment
  const [isWaveformLoading, setIsWaveformLoading] = useState(true); // Loading state

  // --- Audio Engine (Independent of WaveSurfer) ---
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const userAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize invisible audio elements
  useEffect(() => {
    // 1. Source Audio
    const sAudio = new Audio(audioSrc);
    sAudio.crossOrigin = 'anonymous';
    sAudio.preload = 'auto'; // Prioritize preloading
    sourceAudioRef.current = sAudio;

    // 2. User Audio (Empty initially)
    const uAudio = new Audio();
    userAudioRef.current = uAudio;

    return () => {
      sAudio.pause();
      sAudio.src = '';
      uAudio.pause();
      uAudio.src = '';
    };
  }, [audioSrc]);

  // --- Refs ---
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const sourceWs = useRef<WaveSurfer | null>(null);
  const userContainerRef = useRef<HTMLDivElement>(null);
  const userWs = useRef<WaveSurfer | null>(null);

  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const statusRef = useRef(status);

  useEffect(() => { statusRef.current = status; }, [status]);

  // --- Waveform Loader Effect ---
  useEffect(() => {
    let isMounted = true;
    const loadWaveform = async () => {
      console.log('[Waveform] loadWaveform called');
      console.log('[Waveform] waveformData prop:', waveformData);
      console.log('[Waveform] waveformData length:', waveformData?.length);

      let peaks: number[] | null = null;
      let fetchedDuration = 0;
      // 0. Use pre-loaded data if available (e.g. for bundled materials)
      if (waveformData && waveformData.length > 0) {
        if (isMounted) {
          console.log(`[Waveform] Using pre-loaded waveform data (${waveformData.length} peaks)`);

          // Wait for audio to load to get duration
          const audio = sourceAudioRef.current;
          if (audio && audio.duration > 0) {
            fetchedDuration = audio.duration; setDuration(audio.duration);
          } else if (audio) {
            // If duration not ready, wait for it
            const handleLoadedMetadata = () => {
              if (isMounted && audio.duration > 0) {
                setDuration(audio.duration);
              }
            };
            audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
          }

          const normalizedPeaks = waveformData.map((pair: any) => (pair[1] || 0) / 255);
          peaks = normalizedPeaks;
          setIsWaveformLoading(false);
        }
      }

      // 1. Extract ID from audioSrc for remote/remote-cached files
      let recordId: string | null = null;
      const pbMatch = audioSrc.match(/\/api\/files\/[^\/]+\/([^/]+)\//);
      if (pbMatch) recordId = pbMatch[1];
      else {
        const fallbackMatch = audioSrc.match(/\/([^\/]+)\/[^\/]+\.m4a/);
        if (fallbackMatch) recordId = fallbackMatch[1];
      }

      // Fallback for local files
      if (!recordId || recordId === 'media' || recordId === 'Documents' || recordId === 'public') {
        const filenameMatch = audioSrc.match(/\/([^\/]+)\.m4a$/);
        if (filenameMatch && filenameMatch[1].length > 10) recordId = filenameMatch[1];
      }

      console.log(`[Waveform] Source: ${audioSrc}, Extracted ID: ${recordId}`);


      if (recordId) {
        // Try cache first
        const cached = await getCachedWaveform(recordId);
        if (cached) {
          peaks = cached.peaks;
          fetchedDuration = cached.duration || 0;
          if (fetchedDuration > 0 && isMounted) setDuration(fetchedDuration);
        }

        if (!peaks) {
          try {
            const record = await pb.collection('transcripts').getOne(recordId);
            const waveformData = record.waveform_data;

            if (waveformData && Array.isArray(waveformData)) {
              // Flatten to single channel 0-1 values
              peaks = waveformData.map(([, max]: [number, number]) => max / 255);
              fetchedDuration = record.duration || 0;
              if (fetchedDuration > 0 && isMounted) setDuration(fetchedDuration);

              await cacheWaveform(recordId, waveformData, fetchedDuration);
              console.log('[Waveform] Loaded from PocketBase and cached');
            }
          } catch (err) { console.warn(err); }
        }
      }

      if (!isMounted) return;

      let durationForCalc = fetchedDuration > 0 ? fetchedDuration : (duration > 0 ? duration : 0);

      // 🔥 FIX: 如果 duration 仍为 0，从 peaks 数量推算（后端生成是 30 pps）
      if (durationForCalc === 0 && peaks && peaks.length > 0) {
        const BACKEND_PPS = 30; // 后端 waveform-worker.js 的采样率
        durationForCalc = peaks.length / BACKEND_PPS;
        console.log(`🎯 [Waveform DEBUG] Duration fallback from peaks: ${durationForCalc.toFixed(2)}s`);
      }

      const actualPeaksPerSec = (durationForCalc > 0 && peaks) ? (peaks.length / durationForCalc) : PEAKS_PER_SEC;

      console.log(`🎯 [Waveform DEBUG] ========== START ==========`);
      console.log(`🎯 [Waveform DEBUG] Total peaks: ${peaks?.length || 0}`);
      console.log(`🎯 [Waveform DEBUG] Duration: ${durationForCalc.toFixed(2)}s`);
      console.log(`🎯 [Waveform DEBUG] Actual PPS: ${actualPeaksPerSec.toFixed(2)}`);
      console.log(`🎯 [Waveform DEBUG] Segment start: ${segmentStart}s`);

      if (peaks) {
        const startIdx = Math.floor(segmentStart * actualPeaksPerSec);
        const endIdx = Math.min(Math.ceil(startIdx + SEGMENT_DURATION * actualPeaksPerSec), peaks.length);
        let segmentPeaks = peaks.slice(startIdx, endIdx);
        const segmentDuration = (endIdx - startIdx) / actualPeaksPerSec;

        // Store full peaks for segment switching
        setFullPeaks(peaks);

        console.log(`🎯 [Waveform DEBUG] Segment peaks before processing: ${segmentPeaks.length}`);
        console.log(`🎯 [Waveform DEBUG] Segment duration: ${segmentDuration.toFixed(2)}s`);

        // Apple Style Upsampling Logic
        const TARGET_PPS = 25; // 25 peaks per second = perfect for 2px Bar + 2px Gap (100px total)

        console.log(`🎯 [Waveform DEBUG] TARGET_PPS: ${TARGET_PPS}`);
        console.log(`🎯 [Waveform DEBUG] Will interpolate? ${actualPeaksPerSec < TARGET_PPS && segmentPeaks.length > 1}`);

        if (actualPeaksPerSec < TARGET_PPS && segmentPeaks.length > 1) {
          const targetLength = Math.max(Math.floor(segmentDuration * TARGET_PPS), segmentPeaks.length);
          console.log(`🎯 [Waveform DEBUG] Interpolating from ${segmentPeaks.length} to ${targetLength} peaks`);
          segmentPeaks = interpolateWaveform(segmentPeaks, targetLength);
          console.log(`🎯 [Waveform DEBUG] ✅ Interpolation done, new length: ${segmentPeaks.length}`);
        } else {
          console.log(`🎯 [Waveform DEBUG] ⏭️  Skipping interpolation (density sufficient)`);
        }

        if (sourceContainerRef.current) {
          console.log(`🎯 [Waveform DEBUG] Creating WaveSurfer instance...`);
          console.log(`🎯 [Waveform DEBUG] Final segment peaks: ${segmentPeaks.length}`);
          console.log(`🎯 [Waveform DEBUG] normalize: false`);
          console.log(`🎯 [Waveform DEBUG] minPxPerSec: ${PX_PER_SEC}`);

          if (sourceWs.current) {
            console.log(`🎯 [Waveform DEBUG] Destroying existing WaveSurfer instance`);
            sourceWs.current.destroy();
          }

          sourceWs.current = WaveSurfer.create({
            container: sourceContainerRef.current,
            waveColor: 'rgba(255, 255, 255, 0.6)',
            progressColor: 'rgba(255, 255, 255, 1.0)',
            cursorColor: 'transparent',
            // APPLE STYLE METRICS:
            barWidth: 2,
            barGap: 2,
            barRadius: 2,
            height: WAVE_HEIGHT,
            normalize: false, // 🔥 FIX: 禁用，数据已在后端归一化
            minPxPerSec: PX_PER_SEC,
            peaks: [segmentPeaks], // Wrapped in array -> 1 channel
            duration: segmentDuration,
            interact: false, // Purely visual
            autoScroll: false,
          });

          console.log(`🎯 [Waveform DEBUG] ✅ WaveSurfer created successfully`);
          console.log(`🎯 [Waveform DEBUG] ========== END ==========`);

          // Mute visual WaveSurfer (Audio is handled by sourceAudioRef)
          sourceWs.current.setVolume(0);
        }
      }
      setIsWaveformLoading(false);
    };

    loadWaveform();

    return () => {
      isMounted = false;
      if (sourceWs.current) sourceWs.current.destroy();
    };
  }, [audioSrc, segmentStart]);


  // --- Initialization & Restore ---
  useEffect(() => {
    VoiceRecorder.requestAudioRecordingPermission();

    // 2. Load Settings & Session
    const restoreSession = async () => {
      try {
        // A. Settings
        const { value: settingsVal } = await Preferences.get({ key: SETTINGS_KEY });
        if (settingsVal) {
          // const s = JSON.parse(settingsVal);
          // clozeMode restoration removed to ensure 'default hidden' on entry
        }

        // B. Session
        const { value: sessionVal } = await Preferences.get({ key: sessionKey });
        if (sessionVal) {
          const session = JSON.parse(sessionVal);
          if (session.status === 'review' && session.tempPath) {
            // Read Audio File
            try {
              const file = await Filesystem.readFile({
                path: session.tempPath,
                directory: Directory.Cache
              });

              if (file.data) {
                setRecordedBase64(file.data as string);
                setStatus('review');
                // Defer waveform load slightly to allow render
                setTimeout(() => {
                  loadUserReviewWaveform(file.data as string, session.mimeType || 'audio/aac');
                }, 100);
              } else {
                console.warn("RESTORE FILE EMPTY");
              }
            } catch (fe: any) {
              console.error("RESTORE FILE ERR: " + fe.message);
            }
          }
        }
      } catch (e: any) {
        console.error("Restore Error", e);
      }
    };
    restoreSession();

    return () => {
      sourceWs.current?.destroy();
      userWs.current?.destroy();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Dynamic segment switching based on playback position
  useEffect(() => {
    if (!fullPeaks || !duration || duration <= SEGMENT_DURATION) return;

    const checkSegmentBoundary = () => {
      // 🔥 FIX: 使用全局音频时间，而不是 WaveSurfer 内部的相对时间
      const audio = sourceAudioRef.current;
      if (!audio || !sourceWs.current) return;

      const currentTime = audio.currentTime; // 全局播放时间
      const segmentEnd = segmentStart + SEGMENT_DURATION;
      const bufferTime = 10; // Switch when 10s before edge

      // Check if we need to switch to a new segment
      if (currentTime < segmentStart - bufferTime || currentTime > segmentEnd - bufferTime) {
        const newSegmentStart = Math.floor(currentTime / SEGMENT_DURATION) * SEGMENT_DURATION;

        if (newSegmentStart !== segmentStart) {
          console.log(`[Waveform] Switching to segment starting at ${newSegmentStart}s`);

          // Destroy current WaveSurfer
          if (sourceWs.current) {
            sourceWs.current.destroy();
            sourceWs.current = null;
          }

          // Trigger re-render with new segment
          setSegmentStart(newSegmentStart);
        }
      }
    };

    const interval = setInterval(checkSegmentBoundary, 2000);
    return () => clearInterval(interval);
  }, [fullPeaks, duration, segmentStart]);

  // --- Synchronization ---
  const playbackRafRef = useRef<number | null>(null);
  const recordingRafRef = useRef<number | null>(null);

  const scrollToUnsafe = (time: number) => {
    if (!scrollContainerRef.current || isDraggingRef.current) return;
    const targetX = (time * PX_PER_SEC);
    scrollContainerRef.current.scrollLeft = targetX;
  };

  useEffect(() => {
    if (status === 'recording') {
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 66; // 15fps to reduce heat

      const loop = () => {
        const now = performance.now();

        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          const elapsed = (now - startTimeRef.current) / 1000;
          const currentTime = Math.min(elapsed, duration);
          scrollToUnsafe(currentTime);

          // Update WaveSurfer progress visually only
          if (sourceWs.current) {
            sourceWs.current.setTime(currentTime);
          }

          lastUpdateTime = now;
        }

        recordingRafRef.current = requestAnimationFrame(loop);
      };
      loop();
    }
    return () => {
      if (recordingRafRef.current) cancelAnimationFrame(recordingRafRef.current);
    };
  }, [status, duration]);

  const stopPlaybackLoop = () => {
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
    // Pause actual audio
    sourceAudioRef.current?.pause();
    userAudioRef.current?.pause();
  };

  const lastScrollCheckRef = useRef(0);

  const onScroll = () => {
    if (!scrollContainerRef.current) return;
    if (isPlayingMasterRef.current) return; // Do not process scroll events while playing (handled by loop)

    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const time = scrollLeft / PX_PER_SEC;

    // 🔥 FIX: Subtract segmentStart to get relative time in segment
    if (sourceWs.current) {
      // Only update if time is within this segment
      const relativeTime = time - segmentStart;
      if (relativeTime >= 0 && relativeTime <= SEGMENT_DURATION) {
        sourceWs.current.setTime(relativeTime);
      }
    }
    if (userWs.current) userWs.current.setTime(time);

    // Sync Audio Position (Scrubbing)
    // Only seek if we are dragging/scrolling, so when we hit play it starts from here
    if (sourceAudioRef.current && Math.abs(sourceAudioRef.current.currentTime - time) > 0.5) {
      sourceAudioRef.current.currentTime = time;
    }
    if (userAudioRef.current && userDuration > 0 && Math.abs(userAudioRef.current.currentTime - time) > 0.5) {
      userAudioRef.current.currentTime = time;
    }

    // 🔥 FIX: Check if we need to switch segment during manual scroll
    // Throttle to avoid too frequent checks
    const now = Date.now();
    if (now - lastScrollCheckRef.current > 500 && fullPeaks && duration > SEGMENT_DURATION) {
      lastScrollCheckRef.current = now;

      const segmentEnd = segmentStart + SEGMENT_DURATION;
      const bufferTime = 10;

      // If scrolled outside current segment boundaries
      if (time < segmentStart - bufferTime || time > segmentEnd - bufferTime) {
        const newSegmentStart = Math.floor(time / SEGMENT_DURATION) * SEGMENT_DURATION;

        if (newSegmentStart !== segmentStart) {
          console.log(`[Waveform] Manual scroll triggered segment switch to ${newSegmentStart}s`);

          // Destroy current WaveSurfer
          if (sourceWs.current) {
            sourceWs.current.destroy();
            sourceWs.current = null;
          }

          // Trigger re-render with new segment
          setSegmentStart(newSegmentStart);
        }
      }
    }
  };

  const handlePointerDown = () => {
    isDraggingRef.current = true;
    if (isPlayingMasterRef.current) toggleMasterPlay(); // Pause if playing
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
    // On release, sync audio exactly
    if (scrollContainerRef.current) {
      const t = scrollContainerRef.current.scrollLeft / PX_PER_SEC;
      if (sourceAudioRef.current) sourceAudioRef.current.currentTime = t;
      if (userAudioRef.current && userDuration > 0) userAudioRef.current.currentTime = t;
    }
  };

  // --- Exit Handler: Clean up recording if active ---
  const cleanupRecording = async () => {
    if (status === 'recording') {
      try {
        // Stop recording without saving
        await VoiceRecorder.stopRecording();
        console.log('[ShadowingView] Recording stopped due to exit');

        // Cancel recording animation loop
        if (recordingRafRef.current) {
          cancelAnimationFrame(recordingRafRef.current);
        }

        // Reset to idle state (don't save or enter review)
        setStatus('idle');
      } catch (e) {
        console.error('[ShadowingView] Error stopping recording on exit:', e);
      }
    }
  };

  const handleBack = async () => {
    await cleanupRecording();
    onBack();
  };

  const handleHome = async () => {
    await cleanupRecording();
    onHome();
  };

  const isTogglingRef = useRef(false);

  const toggleMasterPlay = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;

    try {
      if (isPlayingMasterRef.current) {
        // STOP ALL
        stopPlaybackLoop();
        setIsPlayingMaster(false);
        isPlayingMasterRef.current = false;
      } else {
        // START ALL
        const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
        const startTime = scrollLeft / PX_PER_SEC;
        const maxDur = Math.max(duration, userDuration);

        // Reset if at end
        if (startTime >= maxDur - 0.2) {
          scrollToUnsafe(0);
          if (sourceAudioRef.current) sourceAudioRef.current.currentTime = 0;
          if (userAudioRef.current) userAudioRef.current.currentTime = 0;
        } else {
          // Sync Current Time
          if (sourceAudioRef.current) sourceAudioRef.current.currentTime = startTime;
          if (userAudioRef.current) userAudioRef.current.currentTime = startTime;
        }

        // Apply Mute State
        if (sourceAudioRef.current) {
          sourceAudioRef.current.volume = isSourceMuted ? 0 : 1.0;
          sourceAudioRef.current.muted = isSourceMuted;
        }
        if (userAudioRef.current) {
          userAudioRef.current.volume = isUserMuted ? 0 : 1.0;
          userAudioRef.current.muted = isUserMuted;
        }

        // Play Actual Audio
        const p1 = sourceAudioRef.current?.play();
        const p2 = userAudioRef.current?.play();

        await Promise.all([p1, p2].filter(p => p !== undefined)).catch(e => console.warn("Play error", e));

        setIsPlayingMaster(true);
        isPlayingMasterRef.current = true;
        startMasterLoop();
      }
    } catch (e) {
      console.error("Master toggle failed", e);
      setIsPlayingMaster(false);
      isPlayingMasterRef.current = false;
    } finally {
      isTogglingRef.current = false;
    }
  };

  const startMasterLoop = () => {
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);

    // We use the actual audio playback time as the truth source
    const useSourceAsMaster = sourceAudioRef.current && !sourceAudioRef.current.paused;
    const masterAudio = useSourceAsMaster ? sourceAudioRef.current : userAudioRef.current;

    // Fallback to performance.now if no audio is playing (rare)
    const sysStart = performance.now();
    const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
    const startOffset = scrollLeft / PX_PER_SEC;

    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 30; // 30fps update for smooth UI

    const loop = () => {
      if (!isPlayingMasterRef.current) return;

      const now = performance.now();

      if (now - lastUpdateTime >= UPDATE_INTERVAL) {

        let uiTime = 0;
        if (masterAudio && !masterAudio.paused) {
          uiTime = masterAudio.currentTime;
        } else {
          // Fallback clock
          const elapsed = (now - sysStart) / 1000;
          uiTime = startOffset + elapsed;
        }

        const maxDur = Math.max(duration, userDuration);

        if (uiTime >= maxDur) {
          uiTime = maxDur;
          scrollToUnsafe(uiTime);
          setIsPlayingMaster(false);
          isPlayingMasterRef.current = false;
          sourceAudioRef.current?.pause();
          userAudioRef.current?.pause();
          cancelAnimationFrame(playbackRafRef.current!);
          return;
        }

        // Update UI
        scrollToUnsafe(uiTime);

        // Update WaveSurfer Visuals (Cursor)
        if (sourceWs.current) {
          const relTime = uiTime - segmentStart;
          // 始终更新进度，不再限制范围
          sourceWs.current.setTime(Math.max(0, Math.min(relTime, SEGMENT_DURATION)));
        }
        if (userWs.current) userWs.current.setTime(uiTime);

        lastUpdateTime = now;
      }

      playbackRafRef.current = requestAnimationFrame(loop);
    };
    playbackRafRef.current = requestAnimationFrame(loop);
  };

  const toggleSourceMute = () => {
    const newState = !isSourceMuted;
    setIsSourceMuted(newState);
    // Control Audio Element
    if (sourceAudioRef.current) {
      sourceAudioRef.current.volume = newState ? 0 : 1.0;
      sourceAudioRef.current.muted = newState;
    }
    // No need to touch WaveSurfer volume as it's always 0
  };

  const toggleUserMute = () => {
    const newState = !isUserMuted;
    setIsUserMuted(newState);
    // Control Audio Element
    if (userAudioRef.current) {
      userAudioRef.current.volume = newState ? 0 : 1.0;
      userAudioRef.current.muted = newState;
    }
  };

  // --- Recording Logic ---

  const stopRecording = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
      await new Promise(r => setTimeout(r, 200));

      const res = await VoiceRecorder.stopRecording();

      sourceWs.current?.pause();
      setStatus('review');

      if (res.value.recordDataBase64) {
        const b64 = res.value.recordDataBase64;
        setRecordedBase64(b64);
        loadUserReviewWaveform(b64, res.value.mimeType);

        // PERSIST SESSION
        try {
          // 🔥 TRACK PROGRESS: Phase 3 Completed
          if (materialId) {
            updateUserProgress(materialId, { current_step: 3 });

            // 📊 ANALYTICS: Track recording completion
            analytics.track('recording_finished', {
              material_id: materialId
            });

            // 📊 Notify parent to end phase and session (completed)
            if (onRecordingComplete) {
              onRecordingComplete();
            }
          }

          const tempPath = `temp_session_${Date.now()}.aac`;
          await Filesystem.writeFile({
            path: tempPath,
            data: b64,
            directory: Directory.Cache
          });

          await Preferences.set({
            key: sessionKey,
            value: JSON.stringify({
              status: 'review',
              tempPath: tempPath,
              mimeType: res.value.mimeType,
              timestamp: Date.now()
            })
          });
        } catch (e: any) { console.warn("Persist Failed", e); alert("PERSIST FAIL: " + e.message); }
      }
    } catch (e: any) {
      alert("Stop Error: " + e.message);
      setStatus('idle');
    }
  };

  useEffect(() => {
    if (status === 'review') {
      if (recordingRafRef.current) cancelAnimationFrame(recordingRafRef.current);
      requestAnimationFrame(() => {
        scrollToUnsafe(0);
        if (sourceWs.current) {
          sourceWs.current.setTime(0);
          sourceWs.current.setVolume(isSourceMuted ? 0 : 1.0);
        }
      });
    }
  }, [status]);

  const startRecording = async () => {
    try {
      // ✅ 阶段1: 立即显示"准备录音" - 用户马上看到反馈
      setStatus('preparing');

      await Haptics.impact({ style: ImpactStyle.Light });
      const canRecord = await VoiceRecorder.canDeviceVoiceRecord();
      if (!canRecord.value) {
        setStatus('idle');
        return alert("Device Capability Error");
      }

      if (userWs.current) { userWs.current.destroy(); userWs.current = null; }
      setRecordedBase64(null);

      // Stop any playback
      sourceAudioRef.current?.pause();
      userAudioRef.current?.pause();

      await VoiceRecorder.startRecording();

      // ✅ 阶段2: 录音真正开始,切换到"录音中"
      setStatus('recording');
      const startOffset = sourceWs.current ? sourceWs.current.getCurrentTime() : 0;
      startTimeRef.current = performance.now() - (startOffset * 1000);

      if (sourceWs.current) sourceWs.current.pause();
    } catch (e: any) {
      setStatus('idle');
      alert('Record Error: ' + e.message);
    }
  };

  const processPeaks = async (blob: Blob): Promise<number[]> => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const rawData = audioBuffer.getChannelData(0);
    const samples = rawData.length;
    const duration = audioBuffer.duration;

    // --- OPTIMIZATION: Skip Sampling (Memory Safe) ---
    // Target fixed 25 peaks per second to match Source Waveform
    const targetPPS = 25;
    const totalPeaks = Math.floor(duration * targetPPS);
    const blockSize = Math.floor(samples / totalPeaks);

    const peaks: number[] = [];

    for (let i = 0; i < totalPeaks; i++) {
      let max = 0;
      // Sampling: Find max in typical block (Skip Sampling happens implicitly by block size)
      const start = i * blockSize;
      // Limit inner loop for performance, checking ~100 samples is statistically enough for max
      const sampleStep = Math.max(1, Math.floor(blockSize / 100));

      for (let j = 0; j < blockSize; j += sampleStep) {
        const sample = Math.abs(rawData[start + j]);
        if (sample > max) max = sample;
      }

      // --- VISUAL: Normalize & Contrast Enhance ---
      // 1. Noise gate
      if (max < 0.01) max = 0;

      // 2. Normalize amplification
      if (max > 0) {
        max = max * 1.5; // Gain boost
        if (max > 1.0) max = 1.0;

        // 3. Contrast Boost (Apple Style)
        max = Math.pow(max, 1.5);
      }

      peaks.push(max);
    }

    console.log(`[Waveform] User Recording: Generated ${peaks.length} peaks (~${targetPPS} pps)`);
    return peaks;
  };

  const loadUserReviewWaveform = async (base64: string, mimeType: string) => {
    if (!userContainerRef.current) return;
    try {
      console.log('[Waveform] Starting load, base64 length:', base64.length);

      const bin = atob(base64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);

      // Load into User Audio Engine
      if (userAudioRef.current) {
        userAudioRef.current.src = url;
        userAudioRef.current.load();
      }

      console.log('[Waveform] Processing peaks...');
      const userPeaks = await processPeaks(blob);

      console.log('[Waveform] Creating WaveSurfer instance...');
      if (userWs.current) userWs.current.destroy();

      userWs.current = WaveSurfer.create({
        container: userContainerRef.current,
        waveColor: '#ff3b30',
        progressColor: '#b02a22',
        cursorColor: 'transparent',
        // --- VISUAL: Apple Style (Matches Source) ---
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: WAVE_HEIGHT,
        url: url, // Still provide URL for audio playback
        peaks: [userPeaks], // Force use of our optimized peaks
        interact: false,
        fillParent: false,
        minPxPerSec: PX_PER_SEC,
        autoScroll: false,
        normalize: true,
      });
      // Visual only
      userWs.current.setVolume(0);

      userWs.current.on('ready', (d) => {
        console.log('[Waveform] Ready, duration:', d);
        setUserDuration(d);
        userWs.current?.setVolume(1.0);
      });
      userWs.current.on('finish', () => { });
      userWs.current.on('error', (err) => {
        console.error('[Waveform] WS Error', err);
        alert('波形加载错误：' + err.message);
      });

      console.log('[Waveform] Load complete');
    } catch (e: any) {
      console.error('[Waveform] Load failed:', e);
      alert('波形加载失败: ' + e.message + '\n\n音频可能过长，建议分段上传。');
    }
  };

  const totalDuration = Math.max(duration, userDuration);
  const totalWidth = totalDuration > 0 ? (totalDuration * PX_PER_SEC) : '100%';

  // 🔥 FIX: Calculate padding based on actual container width, not viewport width
  // This ensures waveform is centered correctly on both mobile and iPad
  const containerWidth = scrollContainerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 448);
  const paddingX = `${containerWidth / 2}px`;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black text-white pt-[env(safe-area-inset-top)] pb-12 overflow-hidden">
      {/* Centered Container for iPad - keeps 50vw padding calculation consistent */}
      <div className="w-full max-w-md md:max-w-2xl lg:max-w-3xl mx-auto h-full flex flex-col relative">
        <div className="flex items-center justify-between h-14 px-4 shrink-0 z-20 bg-black/80 backdrop-blur-md">
          <button onClick={handleBack} className="p-2"><ChevronLeft className="w-6 h-6 text-zinc-400" /></button>
          <div className="flex flex-col items-center">
            <span className="text-xs font-medium text-zinc-500 tracking-widest uppercase">第三步</span>
            <span className="text-sm font-semibold text-white tracking-tight">语速 要一样</span>
          </div>
          <button onClick={handleHome} className="p-2"><X className="w-6 h-6 text-zinc-400" /></button>
        </div>

        <div className="flex-1 relative min-h-0 bg-[#0c0c0c] group">
          {/* Loading Indicator */}
          {isWaveformLoading && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span className="text-sm text-white/60 tracking-wide">加载波形中...</span>
              </div>
            </div>
          )}

          <div
            className={cn(
              "absolute left-1/2 top-0 z-10 -translate-x-1/2 w-[2px] pointer-events-none transition-all duration-300",
              status === 'preparing'
                ? "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.8)] animate-pulse h-[250px]"
                : status === 'recording'
                  ? "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse h-[250px]"
                  : status === 'review'
                    ? "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] bottom-[120px]"
                    : "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] bottom-0"
            )}
          ></div>

          <div
            ref={scrollContainerRef}
            className="w-full h-full overflow-x-auto overflow-y-hidden no-scrollbar relative z-10"
            onScroll={onScroll}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <div
              className="relative h-full"
              style={{
                width: typeof totalWidth === 'number' ? `${totalWidth}px` : totalWidth,
                marginLeft: paddingX,
                marginRight: paddingX,
                minWidth: paddingX
              }}
            >
              <div
                className="absolute top-[40px] h-[160px] opacity-80 pointer-events-none"
                ref={sourceContainerRef}
                style={{
                  left: `${segmentStart * PX_PER_SEC}px`,
                  width: fullPeaks && fullPeaks.length > SEGMENT_DURATION * PEAKS_PER_SEC
                    ? `${SEGMENT_DURATION * PX_PER_SEC}px`
                    : '100%'
                }}
              />

              <div className="absolute top-[214px] left-4 z-30 pointer-events-auto">
                <button
                  onClick={toggleCloze}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/50 rounded-full text-[10px] font-bold text-zinc-100 shadow-xl active:scale-95 transition-all h-[24px] min-w-[60px] justify-center"
                >
                  {clozeMode === 'hidden' && <EyeOff className="w-3 h-3 text-zinc-400" />}
                  {clozeMode === 'partial' && <Eye className="w-3 h-3 text-amber-400" />}
                  {clozeMode === 'visible' && <Eye className="w-3 h-3 text-emerald-400" />}

                  <span className="tracking-widest leading-none text-center">
                    {clozeMode === 'hidden' && "文本"}
                    {clozeMode === 'partial' && "70%"}
                    {clozeMode === 'visible' && "隐藏"}
                  </span>
                </button>
              </div>

              <div className="absolute top-[210px] left-0 w-full h-[30px] pointer-events-none z-20">
                {transcript.map((seg, si) =>
                  seg.words?.map((word, wi) => {
                    const left = word.start * PX_PER_SEC;
                    const width = Math.max((word.end - word.start) * PX_PER_SEC, 20);
                    return (
                      <div
                        key={`${si}-${wi}`}
                        className={cn(
                          "absolute top-[4px] flex items-center justify-center text-xs font-medium transition-all duration-300 select-none px-0.5 whitespace-nowrap overflow-hidden rounded-[2px] h-[18px]",
                          // UI Polish: Block style for Cloze
                          (() => {
                            if (clozeMode === 'hidden') return "bg-zinc-800 text-transparent";
                            if (clozeMode === 'visible') return "text-white/60 bg-transparent";
                            // Partial
                            const isHidden = hiddenIndices.has(`${si}-${wi}`);
                            return isHidden ? "bg-zinc-800 text-transparent" : "text-white/60 bg-transparent";
                          })()
                        )}
                        style={{ left: `${left}px`, width: `${width - 2}px` }} // Add small gap
                      >
                        {word.text}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="absolute top-[250px] left-0 w-full h-[160px] pointer-events-none">
                <div
                  ref={userContainerRef}
                  className={cn(
                    "absolute inset-0 w-full h-full transition-opacity duration-500 delay-100",
                    status === 'review' ? "opacity-100" : "opacity-0"
                  )}
                />
              </div>
            </div>
          </div>

          {status === 'recording' && (
            <div className="absolute left-0 right-0 top-[250px] h-[160px] pointer-events-none z-10 flex flex-col items-center justify-center">
              <div className="absolute w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
              <div className="flex items-center justify-center gap-1.5 h-16 relative z-10">
                <div className="w-1.5 bg-rose-500 rounded-full animate-sound-bar bar-1"></div>
                <div className="w-1.5 bg-rose-400 rounded-full animate-sound-bar bar-2"></div>
                <div className="w-1.5 bg-rose-500 rounded-full animate-sound-bar bar-3"></div>
                <div className="w-1.5 bg-rose-300 rounded-full animate-sound-bar bar-4"></div>
                <div className="w-1.5 bg-rose-500 rounded-full animate-sound-bar bar-5"></div>
                <div className="w-1.5 bg-rose-400 rounded-full animate-sound-bar bar-6"></div>
                <div className="w-1.5 bg-rose-500 rounded-full animate-sound-bar bar-2"></div>
                <div className="w-1.5 bg-rose-300 rounded-full animate-sound-bar bar-4"></div>
                <div className="w-1.5 bg-rose-500 rounded-full animate-sound-bar bar-1"></div>
                <div className="w-1.5 bg-rose-400 rounded-full animate-sound-bar bar-3"></div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                <span className="text-sm font-medium text-rose-500 tracking-wide uppercase">Listening...</span>
              </div>
            </div>
          )}

          {status === 'review' && (
            <>
              <div className="absolute right-0 top-0 bottom-0 w-[48px] border-l border-zinc-800/50 bg-black/20 z-10 animate-in fade-in slide-in-from-right-8">
                <div className="absolute top-[60px] left-0 right-0 flex flex-col items-center gap-2 h-[160px] justify-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={toggleSourceMute}
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200",
                        !isSourceMuted
                          ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.4)] scale-110"
                          : "bg-zinc-800 text-zinc-500 border border-zinc-500"
                      )}
                    >
                      {!isSourceMuted ? <Ear className="w-3.5 h-3.5" /> : <EarOff className="w-3.5 h-3.5" />}
                    </button>
                    <span className="text-[8px] font-bold tracking-widest transition-colors text-zinc-200">原声</span>
                  </div>
                </div>

                <div className="absolute top-[250px] left-0 right-0 flex flex-col items-center gap-2 h-[160px] justify-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={toggleUserMute}
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200",
                        !isUserMuted
                          ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.4)] scale-110"
                          : "bg-zinc-800 text-zinc-500 border border-zinc-500"
                      )}
                    >
                      {!isUserMuted ? <Ear className="w-3.5 h-3.5" /> : <EarOff className="w-3.5 h-3.5" />}
                    </button>
                    <span className="text-[8px] font-bold tracking-widest transition-colors text-zinc-200">录音</span>
                  </div>
                </div>
              </div>

              <button
                onClick={toggleMasterPlay}
                className="absolute left-1/2 -translate-x-1/2 bottom-[30px] z-10 w-20 h-20 rounded-full bg-white text-black shadow-[0_0_40px_rgba(255,255,255,0.4)] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
              >
                {isPlayingMaster ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
              </button>
            </>
          )}
        </div>

        <div className="h-48 bg-zinc-950 flex flex-col justify-between shrink-0 z-20 border-t border-zinc-900 pb-[env(safe-area-inset-bottom)] pt-4 px-6">
          <div className="flex-1 flex items-center justify-center w-full">
            {status === 'idle' && (
              <div className="flex items-center justify-center w-full animate-in fade-in slide-in-from-bottom-4">
                <button onClick={startRecording} className="relative group">
                  <div className="absolute inset-0 bg-red-600 rounded-full blur opacity-20 group-hover:opacity-40 transition-opacity" />
                  <div className="w-20 h-20 rounded-full bg-red-600 border-[3px] border-zinc-900 shadow-2xl flex items-center justify-center group-active:scale-95 transition-transform">
                    <Mic className="w-8 h-8 text-white" />
                  </div>
                </button>
                <span className="absolute mt-28 text-xs text-zinc-500 tracking-wider font-medium">TAP TO RECORD</span>
              </div>
            )}

            {status === 'preparing' && (
              <div className="flex flex-col items-center gap-4 animate-in zoom-in">
                <div className="relative">
                  <div className="absolute inset-0 bg-amber-500/30 rounded-full animate-ping" />
                  <div className="relative w-24 h-24 rounded-full bg-transparent border-[4px] border-amber-500 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                </div>
                <span className="text-amber-500 font-bold tracking-[0.2em] text-xs uppercase animate-pulse">准备录音中...</span>
              </div>
            )}

            {status === 'recording' && (
              <div className="flex flex-col items-center gap-4 animate-in zoom-in">
                <div className="relative">
                  <div className="absolute inset-0 bg-red-500/30 rounded-full animate-ping" />
                  <button onClick={stopRecording} className="relative w-24 h-24 rounded-full bg-transparent border-[4px] border-white flex items-center justify-center transition-transform active:scale-90">
                    <div className="w-10 h-10 bg-red-500 rounded-md shadow-inner" />
                  </button>
                </div>
                <span className="text-red-500 font-bold tracking-[0.2em] text-xs uppercase animate-pulse">Recording...</span>
              </div>
            )}

            {status === 'review' && (
              <div className="w-full h-full flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 px-4 relative z-10">
                <button
                  onClick={() => {
                    if (sourceWs.current) {
                      sourceWs.current.setTime(0);
                      sourceWs.current.pause();
                    }
                    scrollToUnsafe(0);
                    setStatus('idle');
                    Preferences.remove({ key: sessionKey });
                  }}
                  className="flex-[1.2] h-14 rounded-2xl bg-zinc-900 text-zinc-400 font-semibold tracking-wide flex items-center justify-center border border-zinc-800 hover:bg-zinc-800 hover:text-white active:scale-95 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5" />
                    <span>重录</span>
                  </div>
                </button>

                <button
                  onClick={async () => {
                    if (!recordedBase64) return;

                    // 🔒 PAYWALL CHECK
                    // Use PocketBase auth store for stable VIP check (avoids async/cache issues)

                    // Force refresh auth store model if possible
                    if (pb.authStore.isValid && !pb.authStore.model) {
                      try { await pb.collection('users').authRefresh(); } catch (e) { }
                    }

                    const user = pb.authStore.model;
                    const tier = user?.subscription_tier || 'free';
                    console.log('[ShadowingView] Clicked Save. User:', user?.id, 'Tier:', tier);

                    const isPaidUser = tier === 'monthly' || tier === 'quarterly' || tier === 'yearly';

                    if (!isPaidUser) {
                      console.log('[ShadowingView] Access Denied. Showing Paywall.');
                      setShowPaywall(true);
                      return;
                    }

                    console.log('[ShadowingView] Access Granted. Saving...');

                    try {
                      const fileName = "shadowing_" + Date.now() + ".aac";
                      await Filesystem.writeFile({
                        path: fileName,
                        data: recordedBase64,
                        directory: Directory.Documents
                      });
                      alert("保存成功！\n\n已保存至“文件 > 我的iPhone > 语核”文件夹");
                    } catch (e: any) { alert("Save Failed:" + e.message); }
                  }}
                  className="flex-[2] h-14 rounded-2xl bg-[#00D68F] text-black font-bold tracking-wide flex items-center justify-center hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-[#00D68F]/20"
                >
                  <div className="flex items-center gap-2">
                    <Download className="w-5 h-5" />
                    <span>保存录音</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          <Paywall
            isOpen={showPaywall}
            onClose={() => setShowPaywall(false)}
            onSuccess={() => {
              setShowPaywall(false);
              alert("开通成功！请再次点击“保存”按钮。");
            }}
          />
        </div>
      </div>
    </div>
  );
}

// --- HELPER: Smart Interpolation + Contrast (Apple Style) ---
function interpolateWaveform(peaks: number[], targetLength: number): number[] {
  if (peaks.length === 0) return [];
  if (targetLength <= peaks.length) return peaks;

  const result: number[] = [];
  const step = (peaks.length - 1) / (targetLength - 1);

  for (let i = 0; i < targetLength; i++) {
    const index = i * step;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    // 1. Linear Interpolation to get base value
    const val0 = peaks[lower] ?? peaks[peaks.length - 1] ?? 0;
    const val1 = peaks[upper] ?? peaks[peaks.length - 1] ?? 0;
    let val = val0 * (1 - weight) + val1 * weight;

    // 2. Contrast Enhancement (The "Magic" Step)
    // Apply power curve to make peaks taller and valleys distinct
    // Power 1.5 - 2.0 is usually the sweet spot for audio visualization
    if (val > 0.05) {
      val = Math.pow(val, 1.5);
    }

    result.push(val);
  }

  return result;
}
