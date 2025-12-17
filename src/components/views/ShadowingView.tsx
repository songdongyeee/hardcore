import { ChevronLeft, X, Play, Pause, RotateCcw, Ear, EarOff, Mic, Eye, EyeOff, Download } from "lucide-react";
import { transcript } from "@/data/transcript";
import { useState, useRef, useEffect } from "react";
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { cn } from "@/lib/utils";
import WaveSurfer from "wavesurfer.js";
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

const SETTINGS_KEY = 'shadowing_settings_v1';

// --- VISUAL CONSTANTS ---
const WAVE_HEIGHT = 160;
const PX_PER_SEC = 150;

interface ShadowingViewProps {
  onBack: () => void;
  onHome: () => void;
  audioSrc: string;
}

type ShadowingStatus = 'idle' | 'recording' | 'review';

export function ShadowingView({ onBack, onHome, audioSrc }: ShadowingViewProps) {
  // UNIQUE SESSION KEY PER AUDIO FILE
  const sessionKey = `shadowing_session_${audioSrc.replace(/[^a-z0-9]/gi, '_')}`;

  // --- State Machine ---
  const [status, setStatus] = useState<ShadowingStatus>('idle');
  const [clozeMode, setClozeMode] = useState<100 | 70 | 0>(100);

  const toggleCloze = () => {
    const newMode = clozeMode === 100 ? 70 : clozeMode === 70 ? 0 : 100;
    setClozeMode(newMode);
    Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify({ clozeMode: newMode }) });
  };

  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const isPlayingMasterRef = useRef(false); // Ref for Loop Sync

  // Mixer State
  const [isSourceMuted, setIsSourceMuted] = useState(true); // Default OFF (Ear)
  const [isUserMuted, setIsUserMuted] = useState(false);   // Default ON (Mic)

  // Audio Data
  const [duration, setDuration] = useState(0); // Source Duration
  const [userDuration, setUserDuration] = useState(0); // User Duration
  const [recordedBase64, setRecordedBase64] = useState<string | null>(null);

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

  // --- Initialization & Restore ---
  useEffect(() => {
    // 1. Permission Check
    VoiceRecorder.requestAudioRecordingPermission();

    // 2. Load Settings & Session
    const restoreSession = async () => {
      try {
        // A. Settings
        const { value: settingsVal } = await Preferences.get({ key: SETTINGS_KEY });
        if (settingsVal) {
          const s = JSON.parse(settingsVal);
          if (s.clozeMode !== undefined) setClozeMode(s.clozeMode);
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

    // 3. Init Source WaveSurfer
    if (sourceContainerRef.current && !sourceWs.current) {
      sourceWs.current = WaveSurfer.create({
        container: sourceContainerRef.current,
        waveColor: 'rgba(255, 255, 255, 0.6)',
        progressColor: 'rgba(255, 255, 255, 1.0)',
        cursorColor: 'transparent',
        barWidth: 4,
        barGap: 2,
        barRadius: 2,
        height: WAVE_HEIGHT,
        url: audioSrc,
        interact: false,
        fillParent: false,
        minPxPerSec: PX_PER_SEC,
        autoScroll: false,
        normalize: true,
      });

      sourceWs.current.on('ready', (d) => {
        setDuration(d);
        sourceWs.current?.setVolume(0);
        const media = sourceWs.current?.getMediaElement();
        if (media) { media.muted = true; }
      });

      sourceWs.current.on('finish', () => { });
    }

    return () => {
      sourceWs.current?.destroy();
      userWs.current?.destroy();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audioSrc]);

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
      const loop = () => {
        const now = performance.now();
        const elapsed = (now - startTimeRef.current) / 1000;
        const currentTime = Math.min(elapsed, duration);
        scrollToUnsafe(currentTime);
        recordingRafRef.current = requestAnimationFrame(loop);
      };
      loop();
    }
    return () => {
      if (recordingRafRef.current) cancelAnimationFrame(recordingRafRef.current);
    };
  }, [status]);

  const stopPlaybackLoop = () => {
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
  };

  const onScroll = () => {
    if (!scrollContainerRef.current) return;
    if (isPlayingMasterRef.current) return;

    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const time = scrollLeft / PX_PER_SEC;

    if (sourceWs.current) sourceWs.current.setTime(time);
    if (userWs.current) userWs.current.setTime(time);
  };

  const handlePointerDown = () => {
    isDraggingRef.current = true;
    if (isPlayingMasterRef.current) toggleMasterPlay();
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const isTogglingRef = useRef(false);

  const toggleMasterPlay = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;

    try {
      if (isPlayingMasterRef.current) {
        // STOP ALL
        sourceWs.current?.pause();
        userWs.current?.pause();
        stopPlaybackLoop();
        setIsPlayingMaster(false);
        isPlayingMasterRef.current = false;
      } else {
        // START ALL
        const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
        const startTime = scrollLeft / PX_PER_SEC;
        const maxDur = Math.max(duration, userDuration);

        if (startTime >= maxDur - 0.2) {
          scrollToUnsafe(0);
          sourceWs.current?.setTime(0);
          userWs.current?.setTime(0);
        } else {
          sourceWs.current?.setTime(startTime);
          userWs.current?.setTime(startTime);
        }

        sourceWs.current?.setVolume(isSourceMuted ? 0 : 1.0);
        if (sourceWs.current?.getMediaElement()) sourceWs.current.getMediaElement()!.muted = isSourceMuted;

        userWs.current?.setVolume(isUserMuted ? 0 : 1.0);
        if (userWs.current?.getMediaElement()) userWs.current.getMediaElement()!.muted = isUserMuted;

        const p1 = sourceWs.current?.play();
        const p2 = userWs.current?.play();
        Promise.all([p1, p2]).catch(e => console.warn("Play error", e));

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
    const sysStart = performance.now();
    const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
    const startAudioTime = scrollLeft / PX_PER_SEC;

    const loop = () => {
      if (!isPlayingMasterRef.current) return;

      const now = performance.now();
      const elapsed = (now - sysStart) / 1000;
      let uiTime = startAudioTime + elapsed;
      const maxDur = Math.max(duration, userDuration);

      if (uiTime >= maxDur) {
        uiTime = maxDur;
        scrollToUnsafe(uiTime);
        setIsPlayingMaster(false);
        isPlayingMasterRef.current = false;
        sourceWs.current?.pause();
        userWs.current?.pause();
        cancelAnimationFrame(playbackRafRef.current!);
        return;
      }

      scrollToUnsafe(uiTime);
      playbackRafRef.current = requestAnimationFrame(loop);
    };
    playbackRafRef.current = requestAnimationFrame(loop);
  };

  const toggleSourceMute = () => {
    const newState = !isSourceMuted;
    setIsSourceMuted(newState);
    if (sourceWs.current) {
      sourceWs.current.setVolume(newState ? 0 : 1.0);
      if (sourceWs.current.getMediaElement()) sourceWs.current.getMediaElement()!.muted = newState;
    }
  };

  const toggleUserMute = () => {
    const newState = !isUserMuted;
    setIsUserMuted(newState);
    if (userWs.current) {
      userWs.current.setVolume(newState ? 0 : 1.0);
      if (userWs.current.getMediaElement()) userWs.current.getMediaElement()!.muted = newState;
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
      await Haptics.impact({ style: ImpactStyle.Light });
      const canRecord = await VoiceRecorder.canDeviceVoiceRecord();
      if (!canRecord.value) return alert("Device Capability Error");

      if (userWs.current) { userWs.current.destroy(); userWs.current = null; }
      setRecordedBase64(null);

      await VoiceRecorder.startRecording();
      setStatus('recording');
      const startOffset = sourceWs.current ? sourceWs.current.getCurrentTime() : 0;
      startTimeRef.current = performance.now() - (startOffset * 1000);

      if (sourceWs.current) sourceWs.current.pause();
    } catch (e: any) {
      alert('Record Error: ' + e.message);
    }
  };

  const processPeaks = async (blob: Blob): Promise<number[][]> => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const rawData = audioBuffer.getChannelData(0);
    const samples = rawData.length;
    const peaksPerSec = 200;
    const totalPeaks = Math.floor(audioBuffer.duration * peaksPerSec);
    const blockSize = Math.floor(samples / totalPeaks);

    const peaks: number[][] = [];
    for (let i = 0; i < totalPeaks; i++) {
      let max = 0;
      for (let j = 0; j < blockSize; j++) {
        const sample = rawData[(i * blockSize) + j];
        if (Math.abs(sample) > max) max = Math.abs(sample);
      }
      if (max < 0.05) max = 0;
      if (max > 0) {
        max = max * 4.0;
        if (max > 1.0) max = 1.0;
      }
      peaks.push([0, max]);
    }
    return peaks;
  };

  const loadUserReviewWaveform = async (base64: string, mimeType: string) => {
    if (!userContainerRef.current) return;
    try {
      const bin = atob(base64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);

      await processPeaks(blob);

      userWs.current = WaveSurfer.create({
        container: userContainerRef.current,
        waveColor: '#ff3b30',
        progressColor: '#b02a22',
        cursorColor: 'transparent',
        barWidth: 4,
        barGap: 2,
        barRadius: 2,
        height: WAVE_HEIGHT,
        url: url,
        interact: false,
        fillParent: false,
        minPxPerSec: PX_PER_SEC,
        autoScroll: false,
        normalize: false,
      });

      userWs.current.on('ready', (d) => {
        setUserDuration(d);
        userWs.current?.setVolume(1.0);
      });
      userWs.current.on('finish', () => { });
      userWs.current.on('error', (err) => console.error("WS Error", err));
    } catch (e: any) {
      alert('Waveform Load Error: ' + e.message);
    }
  };

  const totalDuration = Math.max(duration, userDuration);
  const totalWidth = totalDuration > 0 ? (totalDuration * PX_PER_SEC) : '100%';
  const paddingX = '50vw';

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black text-white pt-[env(safe-area-inset-top)] pb-12 overflow-hidden">
      <div className="flex items-center justify-between h-14 px-4 shrink-0 z-20 bg-black/80 backdrop-blur-md">
        <button onClick={onBack} className="p-2"><ChevronLeft className="w-6 h-6 text-zinc-400" /></button>
        <span className="text-lg font-semibold">The Mirror</span>
        <button onClick={onHome} className="p-2"><X className="w-6 h-6 text-zinc-400" /></button>
      </div>

      <div className="flex-1 relative min-h-0 bg-[#0c0c0c] group">
        <div
          className={cn(
            "absolute left-1/2 top-0 z-30 -translate-x-1/2 w-[2px] pointer-events-none transition-all duration-300",
            status === 'recording'
              ? "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse h-[220px]"
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
              minWidth: '50vw'
            }}
          >
            <div className="absolute top-[40px] left-0 w-full h-[160px] opacity-80 pointer-events-none" ref={sourceContainerRef} />

            <div className="absolute top-[175px] left-0 w-full h-[30px] pointer-events-none z-20">
              {transcript.map((seg, si) =>
                seg.words?.map((word, wi) => {
                  const left = word.start * PX_PER_SEC;
                  const width = Math.max((word.end - word.start) * PX_PER_SEC, 20);
                  return (
                    <div
                      key={`${si}-${wi}`}
                      className={cn(
                        "absolute top-0 flex items-center justify-center text-xs font-medium transition-all duration-300 select-none px-0.5 whitespace-nowrap overflow-hidden",
                        clozeMode === 100 ? "bg-zinc-800 text-transparent rounded mx-0.5" :
                          clozeMode === 70 ? "text-white/30 blur-[1px]" :
                            "text-white/60"
                      )}
                      style={{ left: `${left}px`, width: `${width}px` }}
                    >
                      {word.text}
                    </div>
                  );
                })
              )}
            </div>

            <div className="absolute top-[220px] left-0 w-full h-[160px] pointer-events-none">
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
          <div className="absolute left-0 right-0 top-[220px] h-[160px] pointer-events-none z-10 flex flex-col items-center justify-center">
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
            <div className="absolute right-0 top-0 bottom-0 w-[48px] border-l border-zinc-800/50 bg-black/20 z-40 animate-in fade-in slide-in-from-right-8">
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
                  <span className={cn(
                    "text-[8px] font-bold tracking-widest transition-colors",
                    !isSourceMuted ? "text-zinc-200" : "text-zinc-700"
                  )}>ORIGIN</span>
                </div>
              </div>

              <div className="absolute top-[220px] left-0 right-0 flex flex-col items-center gap-2 h-[160px] justify-center">
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
                  <span className={cn(
                    "text-[8px] font-bold tracking-widest transition-colors",
                    !isUserMuted ? "text-zinc-200" : "text-zinc-700"
                  )}>RECORD</span>
                </div>
              </div>
            </div>

            <button
              onClick={toggleMasterPlay}
              className="absolute left-1/2 -translate-x-1/2 bottom-[30px] z-50 w-20 h-20 rounded-full bg-white text-black shadow-[0_0_40px_rgba(255,255,255,0.4)] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
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
            <div className="w-full h-full flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 px-4 relative z-50">
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
                  <span>Retry</span>
                </div>
              </button>

              <button
                onClick={async () => {
                  if (!recordedBase64) return;
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
                  <span>Save Recording</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="absolute bottom-8 right-8 z-50">
        <button
          onClick={toggleCloze}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 backdrop-blur border border-zinc-700 rounded-full text-xs font-medium text-zinc-300 shadow-lg active:scale-95 transition-all"
        >
          {clozeMode === 100 && <EyeOff className="w-3.5 h-3.5" />}
          {clozeMode === 70 && <Eye className="w-3.5 h-3.5 opacity-50" />}
          {clozeMode === 0 && <Eye className="w-3.5 h-3.5" />}
          <span>{clozeMode === 0 ? "Show" : `${clozeMode}%`}</span>
        </button>
      </div>

    </div>
  );
}
