import { ChevronLeft, Play, Pause, RotateCcw, Mic, Eye, EyeOff, Download } from "lucide-react";
// import { transcript } from "@/data/transcript"; // REMOVED STATIC IMPORT
import type { TranscriptSegment } from "@/data/transcript";
import { StepGuideModal } from "../ui/StepGuideModal";
import { useState, useRef, useEffect } from "react";
// import { type EvaluationResult } from '@/lib/aiEvaluation'; // AI 功能已隐藏
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
  audioSrc: string;
  transcript: TranscriptSegment[]; // Added Prop
  materialId?: string; // Added Prop
  waveformData?: number[][]; // Waveform visualization data [[min, max], ...]
  onRecordingComplete?: () => void; // 📊 Learning progress callback
}

type ShadowingStatus = 'idle' | 'preparing' | 'recording' | 'review';

export function ShadowingView({ onBack, audioSrc, transcript, materialId, waveformData, onRecordingComplete }: ShadowingViewProps) {
  // UNIQUE SESSION KEY PER AUDIO FILE
  const sessionKey = `shadowing_session_${audioSrc.replace(/[^a-z0-9]/gi, '_')}`;

  // --- AI 评价状态 ---
  /*
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [showEvalPanel, setShowEvalPanel] = useState(false);
  */

  // --- State Machine ---
  const [status, setStatus] = useState<ShadowingStatus>('idle');

  // Paywall Logic
  const [showPaywall, setShowPaywall] = useState(false);

  // --- Cloze State ---
  // Default to 'hint' (Show first 3 words of each segment)
  type ClozeMode = 'hint' | 'visible' | 'hidden';
  const [clozeMode, setClozeMode] = useState<ClozeMode>('hint');
  const [hiddenIndices, setHiddenIndices] = useState<Set<string>>(new Set());

  // Logic: Hint (first 3 words) -> Visible (100%) -> Hidden (0%) -> Hint
  const toggleCloze = () => {
    setClozeMode(prev => {
      if (prev === 'hint') return 'visible';
      if (prev === 'visible') return 'hidden';
      return 'hint';
    });
  };

  // Generate indices to hide when switching to 'hint'
  useEffect(() => {
    if (clozeMode === 'hint') {
      const indices = new Set<string>();
      transcript.forEach((seg, sIdx) => {
        let realWordCount = 0;
        seg.words?.forEach((word, wIdx) => {
          // Only count/hide actual words (any language), not punctuation
          const isRealWord = /\p{L}|\p{N}/u.test(word.text);
          if (isRealWord) {
            realWordCount++;
            // Hide if it's beyond the 3rd word
            if (realWordCount > 3) {
              indices.add(`${sIdx}-${wIdx}`);
            }
          }
        });
      });
      setHiddenIndices(indices);
    } else {
      setHiddenIndices(new Set()); // Clear memory when not needed
    }
  }, [clozeMode, transcript]);

  // 独立播放状态 — 原声 / 自己录音
  const [isSourcePlaying, setIsSourcePlaying] = useState(false);
  const isSourcePlayingRef = useRef(false);
  const [isUserPlaying, setIsUserPlaying] = useState(false);
  const isUserPlayingRef = useRef(false);

  // Audio Data
  const [duration, setDuration] = useState(0); // Source Duration
  const [userDuration, setUserDuration] = useState(0); // User Duration
  // --- 多段录音 ---
  type RecordedSegment = { b64: string; mimeType: string; startTime: number; duration: number; peaks: number[]; url: string };
  const [recordedSegments, setRecordedSegments] = useState<RecordedSegment[]>([]);

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


  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const pausedTimeRef = useRef<number>(0);
  const recordingStartOffsetRef = useRef<number>(0);
  // 多段 WaveSurfer 实例管理
  const segmentWsRefs = useRef<(WaveSurfer | null)[]>([]);
  const segmentContainersRef = useRef<(HTMLDivElement | null)[]>([]);
  const isTogglingRef = useRef(false);
  const statusRef = useRef(status);
  // 追踪 userAudioRef 当前加载的是哪一个录音段索引
  const loadedUserSegIdxRef = useRef<number>(-1);

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
                // 处理 peaks 数据以展示真实波形
                const b64 = file.data as string;
                const binStr2 = atob(b64);
                const bytes2 = new Uint8Array(binStr2.length);
                for (let k = 0; k < binStr2.length; k++) bytes2[k] = binStr2.charCodeAt(k);
                const blob2 = new Blob([bytes2], { type: session.mimeType || 'audio/aac' });
                const url2 = URL.createObjectURL(blob2);
                const peaks2 = await processPeaks(blob2);
                setRecordedSegments([{ b64, mimeType: session.mimeType || 'audio/aac', startTime: 0, duration: 0, peaks: peaks2, url: url2 }]);
                setStatus('review');
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
    sourceAudioRef.current?.pause();
    userAudioRef.current?.pause();
    setIsSourcePlaying(false); setIsUserPlaying(false);
    isSourcePlayingRef.current = false; isUserPlayingRef.current = false;
  };

  const lastScrollCheckRef = useRef(0);

  const onScroll = () => {
    if (!scrollContainerRef.current) return;
    if (isSourcePlayingRef.current || isUserPlayingRef.current) return; // 播放中不处理滚动

    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const time = scrollLeft / PX_PER_SEC;

    if (sourceWs.current) {
      const relativeTime = time - segmentStart;
      if (relativeTime >= 0 && relativeTime <= SEGMENT_DURATION) {
        sourceWs.current.setTime(relativeTime);
      }
    }
    // 同步所有段的 WaveSurfer
    segmentWsRefs.current.forEach((ws, i) => {
      if (ws) {
        const seg = recordedSegments[i];
        if (seg) ws.setTime(Math.max(0, time - seg.startTime));
      }
    });

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
    if (isSourcePlayingRef.current || isUserPlayingRef.current) {
      stopPlaybackLoop();
    }
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



  // 智能滚回：如果当前基准线在最新段的结尾，自动滑回该段起始。返回最终决定的 uiTime。
  const smartScrollIfNeeded = (): number => {
    const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
    const currentTime = scrollLeft / PX_PER_SEC;

    const lastSeg = recordedSegments[recordedSegments.length - 1];
    if (!lastSeg || lastSeg.duration <= 0) return currentTime;

    const segEnd = lastSeg.startTime + lastSeg.duration;
    // 如果离结尾很近（0.5s内），判定为录完音要回播
    if (currentTime >= segEnd - 0.5) {
      scrollToUnsafe(lastSeg.startTime);
      return lastSeg.startTime;
    }
    return currentTime;
  };

  const toggleSourcePlay = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    try {
      if (isSourcePlayingRef.current) {
        sourceAudioRef.current?.pause();
        setIsSourcePlaying(false); isSourcePlayingRef.current = false;
        if (!isUserPlayingRef.current && playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
      } else {
        const uiTime = smartScrollIfNeeded();
        if (sourceAudioRef.current) {
          sourceAudioRef.current.currentTime = uiTime;
          sourceAudioRef.current.volume = 1.0;
          sourceAudioRef.current.muted = false;
          await sourceAudioRef.current.play();
        }
        setIsSourcePlaying(true); isSourcePlayingRef.current = true;
        if (!isUserPlayingRef.current) startMasterLoop();
      }
    } catch (e) { console.error('Source play error', e); }
    finally { isTogglingRef.current = false; }
  };

  const toggleUserPlay = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    try {
      if (isUserPlayingRef.current) {
        userAudioRef.current?.pause();
        setIsUserPlaying(false); isUserPlayingRef.current = false;
        if (!isSourcePlayingRef.current && playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
      } else {
        const uiTime = smartScrollIfNeeded();

        // 🚀 根据当前基准时间找到对应的录音段
        const segIdx = recordedSegments.findIndex(s => uiTime >= s.startTime && uiTime < s.startTime + (s.duration || 999));

        if (userAudioRef.current) {
          if (segIdx !== -1) {
            const seg = recordedSegments[segIdx];
            // 如果切段了，更新 src 并等待加载
            if (loadedUserSegIdxRef.current !== segIdx) {
              userAudioRef.current.src = seg.url;
              loadedUserSegIdxRef.current = segIdx;
              // 等待元数据加载后再寻址播放，防止设置 currentTime 失败
              await new Promise<void>((resolve) => {
                const uAudio = userAudioRef.current;
                if (!uAudio) return resolve();
                const onLoaded = () => {
                  uAudio.removeEventListener('loadedmetadata', onLoaded);
                  resolve();
                };
                uAudio.addEventListener('loadedmetadata', onLoaded);
                uAudio.load();
              });
            }
            userAudioRef.current.currentTime = uiTime - seg.startTime;
            userAudioRef.current.volume = 1.0;
            userAudioRef.current.muted = false;
            await userAudioRef.current.play();
          } else {
            // 当前位置没录音，但用户点了播放，我们让音频静默播放（作为时间轴驱动）
            userAudioRef.current.volume = 0;
            // 如果在 0 附近直接跳过
            userAudioRef.current.currentTime = 0;
            await userAudioRef.current.play();
          }
        }
        setIsUserPlaying(true); isUserPlayingRef.current = true;
        if (!isSourcePlayingRef.current) startMasterLoop();
      }
    } catch (e) {
      console.error('User play error', e);
      setIsUserPlaying(false); isUserPlayingRef.current = false;
    }
    finally { isTogglingRef.current = false; }
  };

  // --- Recording Logic ---

  const stopRecording = async () => {
    try {
      // 🔥 记录暂停时的物理时间点（滚动位置 → 秒），用于继续录音的起点偏移
      const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
      pausedTimeRef.current = scrollLeft / PX_PER_SEC;

      await Haptics.impact({ style: ImpactStyle.Heavy });
      await new Promise(r => setTimeout(r, 200));

      const res = await VoiceRecorder.stopRecording();

      sourceWs.current?.pause();
      setStatus('review');

      if (res.value.recordDataBase64) {
        const b64 = res.value.recordDataBase64;
        const segStartTime = recordingStartOffsetRef.current;
        // const segEndTime = pausedTimeRef.current; // AI 评价范围基准，当前版本隐藏逻辑中暂不使用
        // 追加当前段（内联处理 peaks + blob URL，由 useEffect 创建 WaveSurfer）
        const binStr = atob(b64);
        const byteArr = new Uint8Array(binStr.length);
        for (let k = 0; k < binStr.length; k++) byteArr[k] = binStr.charCodeAt(k);
        const blob = new Blob([byteArr], { type: res.value.mimeType || 'audio/aac' });
        const url = URL.createObjectURL(blob);
        const peaks = await processPeaks(blob);
        setRecordedSegments(prev => [...prev, { b64, mimeType: res.value.mimeType || 'audio/aac', startTime: segStartTime, duration: 0, peaks, url }]);

        // 🤖 停录后自动触发 AI 评价（当前版本已隐藏）
        /*
        setIsEvaluating(true);
        setShowEvalPanel(true);
        const segSentences = transcript
          .filter(s => s.end > segStartTime && s.start < segEndTime)
          .map(s => s.text);
        const sentencesToEval = segSentences.length > 0 ? segSentences : transcript.map(s => s.text);
        evaluateRecording(b64, res.value.mimeType || 'audio/aac', sentencesToEval, materialId)
          .then(result => { setEvalResult(result); setIsEvaluating(false); })
          .catch(() => { setIsEvaluating(false); });
        */

        // PERSIST SESSION
        try {
          if (materialId) {
            updateUserProgress(materialId, { current_step: 3 });
            analytics.track('recording_finished', { material_id: materialId });
            if (onRecordingComplete) onRecordingComplete();
          }
          const tempPath = `temp_session_${Date.now()}.aac`;
          await Filesystem.writeFile({ path: tempPath, data: b64, directory: Directory.Cache });
          await Preferences.set({
            key: sessionKey,
            value: JSON.stringify({ status: 'review', tempPath, mimeType: res.value.mimeType, timestamp: Date.now() })
          });
        } catch (e: any) { console.warn("Persist Failed", e); }
      }
    } catch (e: any) {
      alert("Stop Error: " + e.message);
      setStatus('idle');
    }
  };

  useEffect(() => {
    if (status === 'review') {
      if (recordingRafRef.current) cancelAnimationFrame(recordingRafRef.current);
      // 🔥 FIX: 不再强制归零，保留暂停时的时间轴位置，让用户看到刚才录到的地方
      requestAnimationFrame(() => {
        if (sourceWs.current) {
          sourceWs.current.setVolume(1.0);
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

      // 如果这是重录操作清空的，此时才清空原有的逻辑。在分段录制时，我们保留 userWs 以视觉展示最新一段
      // 这里暂不一刀切 userWs.current.destroy()，因为如果分段继续，希望看到上一段（或只是部分刷新）。
      // 简单起见，这里我们保持 userWs 原状，等录完后再写入新数据。


      // Stop any playback
      sourceAudioRef.current?.pause();
      userAudioRef.current?.pause();

      await VoiceRecorder.startRecording();

      // ✅ 阶段2: 录音真正开始,切换到"录音中"
      setStatus('recording');
      // 🔥 FIX: 用滚动容器的真实物理时间作为偏移（支持从暂停点继续录音）
      const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
      const startOffset = scrollLeft / PX_PER_SEC;
      recordingStartOffsetRef.current = startOffset; // 保存本段起始时间
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

  // segmentStartTime 由调用处传入，JSX 通过 recordedSegments state 读取，故此处以 _ 前缀标注
  const startMasterLoop = () => {
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);

    // 锚点时钟：启动时记录一次位置和系统时间，后续完全由增量驱动，不读取 DOM
    const rawScrollLeft = scrollContainerRef.current?.scrollLeft || 0;
    const anchorTime = rawScrollLeft / PX_PER_SEC;
    const anchorSystemTime = performance.now();

    const loop = () => {
      if (!isSourcePlayingRef.current && !isUserPlayingRef.current) return;

      const now = performance.now();
      const deltaFromAnchor = (now - anchorSystemTime) / 1000;

      // uiTime 只由锚点 + 增量构成，不受 DOM 读写抖动影响
      let uiTime = anchorTime + deltaFromAnchor;

      // 1. 原声基准对齐 (如果是原声播放，以原声音频为准修正，因为它更稳)
      if (isSourcePlayingRef.current && sourceAudioRef.current) {
        uiTime = sourceAudioRef.current.currentTime;
      }

      // 2. 动态音频路由 (录音分段自动对齐)
      if (isUserPlayingRef.current && userAudioRef.current && !isTogglingRef.current) {
        const targetSegIdx = recordedSegments.findIndex(s => uiTime >= s.startTime && uiTime < s.startTime + (s.duration || 0.1));

        if (targetSegIdx !== -1) {
          const seg = recordedSegments[targetSegIdx];
          if (loadedUserSegIdxRef.current !== targetSegIdx) {
            console.log(`[AudioEngine] Stance-Switching to segment ${targetSegIdx}`);
            userAudioRef.current.src = seg.url;
            userAudioRef.current.load();
            userAudioRef.current.currentTime = Math.max(0, uiTime - seg.startTime);
            userAudioRef.current.play().catch(() => { });
            loadedUserSegIdxRef.current = targetSegIdx;
          } else {
            // 纠偏阈值放宽到 0.3s，防止微小漂移导致音频寻址频繁跳变（卡顿元凶）
            const drift = Math.abs(userAudioRef.current.currentTime - (uiTime - seg.startTime));
            if (drift > 0.3) {
              userAudioRef.current.currentTime = uiTime - seg.startTime;
            }
          }
          userAudioRef.current.volume = 1.0;
        } else {
          userAudioRef.current.volume = 0;
        }
      }

      // 3. 检查是否结束
      const lastSeg = recordedSegments[recordedSegments.length - 1];
      const maxUserTime = lastSeg ? lastSeg.startTime + lastSeg.duration : 0;
      const totalDuration = duration || 0;

      if (isSourcePlayingRef.current && uiTime >= totalDuration - 0.01) {
        sourceAudioRef.current?.pause();
        setIsSourcePlaying(false); isSourcePlayingRef.current = false;
      }
      if (isUserPlayingRef.current && uiTime >= maxUserTime - 0.01) {
        userAudioRef.current?.pause();
        setIsUserPlaying(false); isUserPlayingRef.current = false;
      }

      if (!isSourcePlayingRef.current && !isUserPlayingRef.current) {
        if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
        return;
      }

      // 4. 同步 UI 和波形
      scrollToUnsafe(uiTime);
      if (sourceWs.current) {
        const relTime = uiTime - segmentStart;
        sourceWs.current.setTime(Math.max(0, Math.min(relTime, SEGMENT_DURATION)));
      }
      segmentWsRefs.current.forEach((ws, i) => {
        if (ws) {
          const seg = recordedSegments[i];
          if (seg && seg.duration > 0) {
            const relT = uiTime - seg.startTime;
            ws.setTime(Math.max(0, Math.min(relT, seg.duration)));
          }
        }
      });

      playbackRafRef.current = requestAnimationFrame(loop);
    };
    playbackRafRef.current = requestAnimationFrame(loop);
  };

  // 每新增一段录音，创建对应的 WaveSurfer 实例
  useEffect(() => {
    if (recordedSegments.length === 0) return;
    const i = recordedSegments.length - 1;
    const seg = recordedSegments[i];
    if (!seg.peaks || seg.peaks.length === 0 || !seg.url) return;

    requestAnimationFrame(() => {
      const container = segmentContainersRef.current[i];
      if (!container) return;

      if (segmentWsRefs.current[i]) { segmentWsRefs.current[i]!.destroy(); }

      const ws = WaveSurfer.create({
        container,
        waveColor: '#ff3b30',
        progressColor: '#c0392b',
        cursorColor: 'transparent',
        barWidth: 2, barGap: 2, barRadius: 2,
        height: WAVE_HEIGHT,
        url: seg.url,
        peaks: [seg.peaks],
        interact: false,
        fillParent: false,
        minPxPerSec: PX_PER_SEC,
        autoScroll: false,
        normalize: true,
      });
      ws.setVolume(0);
      segmentWsRefs.current[i] = ws;

      // 最新段 → 设为用户音频源
      if (userAudioRef.current) {
        userAudioRef.current.src = seg.url;
        userAudioRef.current.load();
        loadedUserSegIdxRef.current = i; // 同步记录当前加载的段索引
      }

      ws.on('ready', (d) => {
        setUserDuration(d);
        ws.setVolume(1.0);
        setRecordedSegments(prev =>
          prev.length > 0
            ? [...prev.slice(0, -1), { ...prev[prev.length - 1], duration: d }]
            : prev
        );
      });
      ws.on('error', (err) => console.error('[SegmentWS] Error:', err));
    });
  }, [recordedSegments.length]);

  // 总用户录音的时间范围 = 最后一段的起始 + 时长
  const lastSeg = recordedSegments[recordedSegments.length - 1];
  const totalUserDuration = lastSeg
    ? lastSeg.startTime + (lastSeg.duration > 0 ? lastSeg.duration : userDuration)
    : userDuration;
  const totalDuration = Math.max(duration, totalUserDuration);
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
          <button onClick={handleBack} className="p-2 w-10"><ChevronLeft className="w-6 h-6 text-zinc-400 hover:text-white" /></button>
          <div className="flex flex-col items-center">
            <span className="text-xs font-medium text-zinc-500 tracking-widest uppercase">第三步</span>
            <span className="text-sm font-semibold text-white tracking-tight">语速 要一样</span>
          </div>
          <div className="flex items-center justify-end w-10">
            <StepGuideModal
              stepKey="shadowing"
              title="第三步方法提示"
              onOpen={() => {
                sourceAudioRef.current?.pause();
                userAudioRef.current?.pause();
              }}
              onClose={() => {
                if (isSourcePlayingRef.current) sourceAudioRef.current?.play().catch(() => { });
                if (isUserPlayingRef.current) userAudioRef.current?.play().catch(() => { });
              }}
              description={
                <div className="flex flex-col gap-4 text-left">
                  <p>复述或背诵整段内容，注意语速和时间。</p>
                  <p>一段一段复述，对比录音和原材料。</p>
                </div>
              }
            />
          </div>
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

              <div className="absolute top-[214px] left-0 z-40 pointer-events-auto sticky left-4 w-fit">
                <button
                  onClick={toggleCloze}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/50 rounded-full text-[10px] font-bold text-zinc-100 shadow-xl active:scale-95 transition-all h-[24px] min-w-[60px] justify-center"
                >
                  {clozeMode === 'hint' && <Eye className="w-3 h-3 text-amber-400" />}
                  {clozeMode === 'visible' && <Eye className="w-3 h-3 text-emerald-400" />}
                  {clozeMode === 'hidden' && <EyeOff className="w-3 h-3 text-zinc-400" />}

                  <span className="tracking-widest leading-none text-center">
                    {clozeMode === 'hint' && "提示"}
                    {clozeMode === 'visible' && "全部"}
                    {clozeMode === 'hidden' && "已隐藏"}
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
                          "absolute top-[4px] flex items-center justify-start text-xs font-medium transition-all duration-300 select-none px-0.5 whitespace-nowrap overflow-hidden rounded-[2px] h-[18px] text-left",
                          // UI Polish: Block style for Cloze
                          (() => {
                            if (clozeMode === 'hidden') return "bg-zinc-800 text-transparent";
                            if (clozeMode === 'visible') return "text-white/60 bg-transparent";
                            // Hint mode
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

              {/* 所有录音段：各有独立 WaveSurfer，定位在正确起始处，段间有分割线 */}
              {recordedSegments.map((seg, i) => (
                <div
                  key={`seg-container-${i}`}
                  className="absolute top-[250px] h-[160px] pointer-events-none"
                  style={{
                    left: `${seg.startTime * PX_PER_SEC}px`,
                    borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  }}
                  ref={(el) => { segmentContainersRef.current[i] = el; }}
                />
              ))}
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

          {/* 🎵 悬浮播放按钮——固定在屏幕水平居中，分别浮在原声 / 录音波形上 */}
          {!showPaywall && status !== 'recording' && status !== 'preparing' && (
            <button
              onClick={toggleSourcePlay}
              className="absolute left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-1 active:scale-95 transition-transform"
              style={{ top: '92px' }}
            >
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl relative",
                isSourcePlaying
                  ? "bg-white text-black scale-105 shadow-white/40"
                  : "bg-zinc-900/80 text-white border border-white/20 backdrop-blur-xl"
              )}>
                {isSourcePlaying
                  ? <Pause className="w-4 h-4 fill-current" />
                  : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </div>
              <div className="px-1.5 py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10">
                <span className={cn("text-[8px] font-bold tracking-wider",
                  isSourcePlaying ? "text-white" : "text-white/60"
                )}>原声</span>
              </div>
            </button>
          )}
          {!showPaywall && recordedSegments.length > 0 && status !== 'recording' && status !== 'preparing' && (
            <button
              onClick={toggleUserPlay}
              className="absolute left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-1 active:scale-95 transition-transform"
              style={{ top: '300px' }}
            >
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl relative",
                isUserPlaying
                  ? "bg-red-500 text-white scale-105 shadow-red-500/50"
                  : "bg-zinc-900/80 text-red-500 border border-red-500/20 backdrop-blur-xl shadow-red-500/5"
              )}>
                {isUserPlaying
                  ? <Pause className="w-4 h-4 fill-current" />
                  : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </div>
              <div className="px-1.5 py-0.5 rounded-full bg-red-500/10 backdrop-blur-md border border-red-500/20">
                <span className={cn("text-[8px] font-bold tracking-wider",
                  isUserPlaying ? "text-red-500" : "text-red-500/60"
                )}>录音</span>
              </div>
            </button>
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
                <span className="absolute mt-28 text-xs text-zinc-500 tracking-wider font-medium">点击录音</span>
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
              <div className="w-full h-full flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-4 px-4 relative z-10">
                {/* 重录 */}
                <button
                  onClick={() => {
                    if (sourceWs.current) { sourceWs.current.setTime(0); sourceWs.current.pause(); }
                    segmentWsRefs.current.forEach(ws => ws?.destroy());
                    segmentWsRefs.current = [];
                    segmentContainersRef.current = [];
                    scrollToUnsafe(0);
                    setRecordedSegments([]);
                    setUserDuration(0);
                    recordingStartOffsetRef.current = 0;
                    setStatus('idle');
                  }}
                  className="flex-1 h-14 rounded-2xl bg-zinc-900 text-zinc-400 font-semibold flex items-center justify-center gap-1.5 border border-zinc-800 hover:bg-zinc-800 hover:text-white active:scale-95 transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-sm">重录</span>
                </button>

                {/* 继续录制 */}
                <button
                  onClick={() => {
                    setStatus('idle');
                    // 不重置 sourceWs 进度，允许从刚好结束的地方继续录新的一段！
                  }}
                  className="flex-[1.6] h-14 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center gap-1.5 hover:bg-indigo-500 active:scale-95 transition-all shadow-lg shadow-indigo-900/50"
                >
                  <span className="text-sm">继续</span>
                </button>

                {/* 保存所有段落录音 */}
                <button
                  onClick={async () => {
                    if (recordedSegments.length === 0) return;
                    if (pb.authStore.isValid && !pb.authStore.model) {
                      try { await pb.collection('users').authRefresh(); } catch (e) { }
                    }
                    const user = pb.authStore.model;
                    const isPaidUser = (user?.subscription_tier || 'free') !== 'free';
                    if (!isPaidUser) { setShowPaywall(true); return; }
                    try {
                      for (let i = 0; i < recordedSegments.length; i++) {
                        const fileName = `shadowing_${Date.now()}_part${i + 1}.aac`;
                        await Filesystem.writeFile({ path: fileName, data: recordedSegments[i].b64, directory: Directory.Documents });
                      }
                      alert(`保存成功！\n\n已无损保存 ${recordedSegments.length} 段录音至\u201c文件 > 我的iPhone > 语核\u201d文件夹`);
                    } catch (e: any) { alert("Save Failed:" + e.message); }
                  }}
                  className="flex-1 h-14 rounded-2xl bg-[#00D68F]/10 text-[#00D68F] font-semibold flex items-center justify-center gap-1.5 border border-[#00D68F]/30 hover:bg-[#00D68F]/20 active:scale-95 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-sm">保存</span>
                </button>
              </div>
            )}
          </div>

          <Paywall
            isOpen={showPaywall}
            onClose={() => setShowPaywall(false)}
            onSuccess={() => { setShowPaywall(false); alert("开通成功！请再次点击\u201c保存\u201d按钮。"); }}
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
