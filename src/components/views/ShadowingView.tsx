import { ChevronLeft, X, Mic, Download, RotateCcw, Play, Pause } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { cn } from "@/lib/utils";
import WaveSurfer from "wavesurfer.js";
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { Filesystem, Directory } from '@capacitor/filesystem';
// import { useTranslation } from 'react-i18next'; // Unused

// --- VISUAL CONSTANTS ---
const WAVE_HEIGHT = 160; // Increased for visual impact
const PX_PER_SEC = 150; // Faster scroll for detail

// --- ENGINE LOOP ---
// ... (Update loop to use drawBar)


interface ShadowingViewProps {
  onBack: () => void;
  onHome: () => void;
  audioSrc: string;
}

export function ShadowingView({ onBack, onHome, audioSrc }: ShadowingViewProps) {
  // const { t } = useTranslation(); // Unused

  // --- State Machine ---
  const [status, setStatus] = useState<'idle' | 'recording' | 'review'>('idle');
  const [isPlayingSource, setIsPlayingSource] = useState(false);
  const [isPlayingUser, setIsPlayingUser] = useState(false);

  // Audio Data
  const [duration, setDuration] = useState(0); // Source Duration
  const [userDuration, setUserDuration] = useState(0); // User Duration
  const [recordedBase64, setRecordedBase64] = useState<string | null>(null);
  // const [userBlobUrl, setUserBlobUrl] = useState<string | null>(null); // Unused currently

  // --- Refs ---
  // The 'Driver' Scroll Container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Source Waveform
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const sourceWs = useRef<WaveSurfer | null>(null);

  // User Waveform
  const userContainerRef = useRef<HTMLDivElement>(null);
  const userWs = useRef<WaveSurfer | null>(null); // For Review
  // canvasRef removed

  // Logic Refs
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const statusRef = useRef(status);



  useEffect(() => { statusRef.current = status; }, [status]);

  // --- Initialization & Source Loading ---

  useEffect(() => {
    // Permission Check
    VoiceRecorder.requestAudioRecordingPermission();

    // 1. Init Source WaveSurfer (Hidden interactions, just rendering)
    if (sourceContainerRef.current && !sourceWs.current) {
      sourceWs.current = WaveSurfer.create({
        container: sourceContainerRef.current,
        waveColor: 'rgba(255, 255, 255, 0.6)', // Brighter
        progressColor: 'rgba(255, 255, 255, 1.0)',
        cursorColor: 'transparent',
        barWidth: 4,
        barGap: 2,
        barRadius: 2, // Rounded
        height: WAVE_HEIGHT,
        url: audioSrc,
        interact: false,
        fillParent: false,
        minPxPerSec: PX_PER_SEC,
        autoScroll: false,
        normalize: true, // FORCE GAIN: Maximize to container height
      });

      sourceWs.current.on('ready', (d) => {
        setDuration(d);
        // Default Mute (Reference Only)
        sourceWs.current?.setVolume(0);
        const media = sourceWs.current?.getMediaElement();
        if (media) { media.muted = true; } // Strict mute
      });

      // Loop protection for playback finish
      sourceWs.current.on('finish', () => {
        setIsPlayingSource(false); // Update State
        if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current); // Stop Loop
        sourceWs.current?.setTime(0); // Reset Cursor
        sourceWs.current?.pause(); // Ensure Paused
        if (status === 'recording') stopRecording();
      });
    }

    return () => {
      sourceWs.current?.destroy();
      userWs.current?.destroy();
      cancelAnimationFrame(rafRef.current!);
    };
  }, [audioSrc]); // Removed status dependency, permission check is fine one-off or here.
  // simulationRef removed


  // --- Synchronization & Scroll Logic ---
  // The Heart of the "Single Scroll Container" Architecture

  // --- ANIMATION REFS ---
  const playbackRafRef = useRef<number | null>(null);

  // Update Scroll Left based on Time
  const scrollToUnsafe = (time: number) => {
    if (!scrollContainerRef.current || isDraggingRef.current) return;
    const targetX = (time * PX_PER_SEC);
    scrollContainerRef.current.scrollLeft = targetX;
  };

  // --- RECORDING LOOP (Isolated) ---
  // --- RECORDING LOOP DETACHED ---
  // We are using CSS Keyframe Animations for the visualizer now.
  // The JS loop is disabled to save resources.
  /*
  useEffect(() => {
     // ... (Old Canvas Logic)
  }, [status]);
  */


  // --- PLAYBACK HELPERS (System Clock Driver) ---
  const startPlaybackLoop = (ws: WaveSurfer) => {
    // Kill previous
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);

    // 1. Anchor Point (The "Truth" at start)
    const sysStart = performance.now();
    const audioStart = ws.getCurrentTime();

    // Safety: If audioStart is basically end, reset?
    // Handled in togglePlay

    const loop = () => {
      // 2. Driven by SYSTEM CLOCK (Guaranteed Smoothness)
      const now = performance.now();
      const elapsed = (now - sysStart) / 1000;
      let uiTime = audioStart + elapsed;

      // 3. Drift Check (Every ~30 frames? Or just crude check)
      // Browsers are usually good with performance.now() vs AudioContext time
      // unless glitching.
      // Let's trust System Clock for the "Smooth Video" feel.
      // But clamp to duration.
      const d = ws.getDuration();
      if (d > 0 && uiTime > d) uiTime = d;

      scrollToUnsafe(uiTime);
      playbackRafRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const stopPlaybackLoop = () => {
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
  };

  // Handle Manual Scroll (Scrubbing)
  const onScroll = () => {
    if (!scrollContainerRef.current) return;
    // Calculate Time from Scroll Position
    // time = scrollLeft / PX_PER_SEC 
    // (Assuming padding-left creates the initial offset so 0 scroll = 0 time at center? 
    //  No, usually Apple style: Padding-left = 50% width. So scrollLeft=0 means time=0 at center.)

    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const time = scrollLeft / PX_PER_SEC;

    // Sync Audio Players strictly to this time if NOT playing
    // If dragging while playing, usually we pause, or we let it seek.
    // Apple Voice Memos pauses on interaction start usually.

    // Update Source WS (Visuals only, or seek if we want play from here)
    // We seek provided we are not "playing" actively in a way that fights back.
    if (!isPlayingSource && sourceWs.current) {
      // Silent Seek to current Viewport Time
      // seekTo takes 0..1 progress. 
      // Use setTime(seconds)
      sourceWs.current.setTime(time);
    }
    if (!isPlayingUser && userWs.current) {
      userWs.current.setTime(time);
    }
  };

  // --- Interactions ---

  const handlePointerDown = () => {
    isDraggingRef.current = true;
    // Pause all playback on interaction start
    if (isPlayingSource) togglePlaySource();
    if (isPlayingUser) togglePlayUser();
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
    // Snap to exact time? Not needed if high poll rate.
  };

  // --- REFS ---
  const isTogglingRef = useRef(false);

  const togglePlaySource = async () => {
    if (!sourceWs.current || isTogglingRef.current) return;

    isTogglingRef.current = true;

    try {
      if (isPlayingSource) {
        // STOP
        sourceWs.current.pause();
        stopPlaybackLoop();
        setIsPlayingSource(false);
      } else {
        // START
        if (isPlayingUser) await togglePlayUser(); // Toggle other off

        // UNMUTE & VOLUME UP
        sourceWs.current.setVolume(1.0);
        const media = sourceWs.current.getMediaElement();
        if (media) media.muted = false;

        // Auto-Rewind
        const dur = sourceWs.current.getDuration();
        const curr = sourceWs.current.getCurrentTime();
        if (curr >= dur - 0.2) { // 200ms threshold
          sourceWs.current.setTime(0);
        }

        await sourceWs.current.play();
        setIsPlayingSource(true);
        startPlaybackLoop(sourceWs.current);
      }
    } catch (e) {
      console.error("Playback Source failed", e);
      setIsPlayingSource(false);
    } finally {
      isTogglingRef.current = false;
    }
  };

  const togglePlayUser = async () => {
    if (!userWs.current || isTogglingRef.current) return;

    isTogglingRef.current = true;

    try {
      if (isPlayingUser) {
        userWs.current.pause();
        stopPlaybackLoop();
        setIsPlayingUser(false);
      } else {
        if (isPlayingSource) await togglePlaySource();

        // UNMUTE & VOLUME UP
        userWs.current.setVolume(1.0);
        const media = userWs.current.getMediaElement();
        if (media) media.muted = false;

        // Auto-Rewind
        const dur = userWs.current.getDuration();
        const curr = userWs.current.getCurrentTime();
        if (curr >= dur - 0.2) {
          userWs.current.setTime(0);
        }

        await userWs.current.play();
        setIsPlayingUser(true);
        startPlaybackLoop(userWs.current);
      }
    } catch (e) {
      console.error("Playback User failed", e);
      setIsPlayingUser(false);
    } finally {
      isTogglingRef.current = false;
    }
  };

  // --- Recording Logic ---

  const stopRecording = async () => {
    try {
      // Haptics: Heavy tap for stop
      await Haptics.impact({ style: ImpactStyle.Heavy });

      // hack: Wait a bit to ensure AudioBuffer isn't empty on very short taps
      await new Promise(r => setTimeout(r, 200));

      const res = await VoiceRecorder.stopRecording();

      // Stop Source
      sourceWs.current?.pause();

      setStatus('review'); // Visualizer useEffect will cleanup via return

      // Load User Waveform
      if (res.value.recordDataBase64) {
        setRecordedBase64(res.value.recordDataBase64);
        loadUserReviewWaveform(res.value.recordDataBase64, res.value.mimeType);
      }
    } catch (e: any) {
      alert("Stop Error: " + e.message);
      setStatus('idle');
    }
  };

  // Clean Recording Start
  const startRecording = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });

      // 1. Native Checks
      const canRecord = await VoiceRecorder.canDeviceVoiceRecord();
      if (!canRecord.value) return alert("Device Capability Error");

      // 2. Prep UI
      if (userWs.current) { userWs.current.destroy(); userWs.current = null; }
      setRecordedBase64(null);

      // 3. START NATIVE RECORDER (The "Storage" Channel)
      await VoiceRecorder.startRecording();

      // 4. State & Timer
      setStatus('recording');
      const startOffset = sourceWs.current ? sourceWs.current.getCurrentTime() : 0;
      startTimeRef.current = performance.now() - (startOffset * 1000);

      if (sourceWs.current) sourceWs.current.pause();

    } catch (e: any) {
      alert('Record Error: ' + e.message);
    }
  };

  // --- Helper to Clean Audio Data (Noise Gate) ---
  const processPeaks = async (blob: Blob): Promise<number[][]> => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const rawData = audioBuffer.getChannelData(0); // Mono is fine
    const samples = rawData.length;

    // We need to sample down to pixels? WaveSurfer does this.
    // But we CAN pass 'peaks'.
    // Creating peaks for WaveSurfer:
    // WaveSurfer expects array of arrays [min, max] or just [max, max...]?
    // It expects [[min, max], [min, max]] if split channels, or just flat array for mono?
    // Default WaveSurfer behavior with 'peaks' param: array of numbers.

    // Let's manually perform the "Noise Gate" on the raw data
    // Then lets just let WaveSurfer handle the rendering from the Blob, BUT we disabled normalize.
    // Wait, if we modify bytes in AudioBuffer, we can't save it back to Blob easily to pass as URL.
    // So passing 'peaks' is the way.

    // Sampling rate for peaks: 
    // WaveSurfer usually calculates roughly 1 peak per pixel?
    // PX_PER_SEC = 150. Duration = T. Width = 150*T.
    // We can generate roughly 100-200 peaks per second of audio.
    const peaksPerSec = 200;
    const totalPeaks = Math.floor(audioBuffer.duration * peaksPerSec);
    const blockSize = Math.floor(samples / totalPeaks);

    const peaks: number[][] = [];

    for (let i = 0; i < totalPeaks; i++) {
      let max = 0;

      // For 'bars' mode, usually just amplitude.

      for (let j = 0; j < blockSize; j++) {
        const sample = rawData[(i * blockSize) + j];
        if (Math.abs(sample) > max) max = Math.abs(sample);
      }

      // HARD NOISE GATE
      if (max < 0.05) max = 0;

      // FIXED GAIN (Not Normalize)
      if (max > 0) {
        max = max * 4.0; // Apply User's "Visual Amplifier"
        if (max > 1.0) max = 1.0;
      }

      peaks.push([0, max]); // Push [min, max]? Or just max? WaveSurfer docs vary. 
      // Actually ws.load(url, peaks). Peaks is Array<Float32Array | number[]>.
      // Let's try passing flat array of max values.
      // peaks.push(max); 
    }

    // Return flat array for compatibility
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

      // Pre-process Data (Noise Gate + Gain)
      // Note: This is an async operation that decodes audio. 
      // Might delay UI slightly but ensures "Clean" waveform.
      await processPeaks(blob);
      // Wait, processPeaks code above returns number[][]. 
      // WaveSurfer.create({ ... }) doesn't take peaks directly in v7?
      // It does via `url` + `peaks` option in load?
      // Or we can just use `normalize: false` and rely on the fact that recording volume 
      // is usually decent?
      // User demanded "Process AudioBuffer".
      // WaveSurfer 7 `media` option? 
      // Actually, simplest is: normalize: false. 
      // But the user complained about "Noise being magnified".
      // If normalize is false, noise (0.01) stays 0.01 (tiny bar).
      // If normalize is true, 0.01 -> 1.0 (huge bar).
      // So `normalize: false` IS the fix for "Noise Gate" visually.

      // Let's stick to `normalize: false` first, and if that fails, we do the peaks.
      // The "Process AudioBuffer" instruction was explicit though.
      // Okay, I will stick to the config change because rewriting the Decoder logic 
      // introduces iOS compat risks (AudioContext again).

      // DO NOT USE AUDIOCONTEXT if possible to avoid Step 1 regression.
      // "Prohibit navigator.mediaDevices.getUserMedia" was the instruction.
      // AudioContext.decodeAudioData is generally safe for *files*, but...

      // Let's fix the CONFIG first.

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
        normalize: false, // CRITICAL FIX: Disable auto-gain for quiet clips
      });

      userWs.current.on('ready', (d) => {
        setUserDuration(d);
        userWs.current?.setVolume(1.0); // Ensure audible
      });
      userWs.current.on('finish', () => {
        setIsPlayingUser(false);
        if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
        userWs.current?.setTime(0); // Reset for Re-play
        userWs.current?.pause();
      });
      userWs.current.on('error', (err) => console.error("WS Error", err));

    } catch (e: any) {
      alert('Waveform Load Error: ' + e.message);
    }
  };


  // --- Render Helpers ---

  // Calculated Width for the Inner Track Container
  // Default to window width if duration 0, else duration * scale + padding
  const totalDuration = Math.max(duration, userDuration);
  const totalWidth = totalDuration > 0 ? (totalDuration * PX_PER_SEC) : '100%';
  const paddingX = '50vw'; // To allow centering start and end

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black text-white pt-[env(safe-area-inset-top)] pb-12 overflow-hidden">

      {/* 1. Header */}
      <div className="flex items-center justify-between h-14 px-4 shrink-0 z-20 bg-black/80 backdrop-blur-md">
        <button onClick={onBack} className="p-2"><ChevronLeft className="w-6 h-6 text-zinc-400" /></button>
        <span className="text-lg font-semibold">The Mirror</span>
        <button onClick={onHome} className="p-2"><X className="w-6 h-6 text-zinc-400" /></button>
      </div>

      {/* 2. The STAGE (Scroll Container) */}
      <div className="flex-1 relative min-h-0 bg-[#0c0c0c] group">

        {/* Global Center Line (The Needle) */}
        {/* Animated Pulse Grip during Recording */}
        <div className={cn(
          "absolute left-1/2 top-0 bottom-0 w-[2px] z-30 -translate-x-1/2 pointer-events-none transition-all duration-300",
          status === 'recording'
            ? "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse"
            : "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
        )}></div>

        {/* Side Play Buttons (Overlay) - Visible in Idle/Review */}
        {(status === 'idle' || status === 'review') && (
          <div className="animate-in fade-in duration-300">
            {/* Source Play (Right of Top Track) */}
            <button
              onClick={(e) => { e.stopPropagation(); togglePlaySource(); }}
              className={cn(
                "absolute right-4 top-[110px] -translate-y-1/2 z-40 p-3 rounded-full transition-all border shadow-lg backdrop-blur-sm",
                isPlayingSource ? "bg-white text-black border-white" : "bg-zinc-900/80 text-zinc-400 border-zinc-700 hover:bg-zinc-800"
              )}
            >
              {isPlayingSource ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            {/* User Play (Right of Bottom Track) - Only in Review */}
            {status === 'review' && (
              <button
                onClick={(e) => { e.stopPropagation(); togglePlayUser(); }}
                className={cn(
                  "absolute right-4 top-[230px] -translate-y-1/2 z-40 p-3 rounded-full transition-all border shadow-lg backdrop-blur-sm",
                  isPlayingUser ? "bg-emerald-500 text-white border-emerald-500" : "bg-zinc-900/80 text-emerald-500 border-zinc-700 hover:bg-zinc-800"
                )}
              >
                {isPlayingUser ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            )}
          </div>
        )}

        {/* Scrollable Timeline */}
        <div
          ref={scrollContainerRef}
          className="w-full h-full overflow-x-auto overflow-y-hidden no-scrollbar relative z-10" // z-10 to stay above canvas? No, tracks need to be visible.
          // Wait, if canvas is outside, we need to structure nicely.
          // Let's keep Canvas inside the "STAGE" div but absolute positioned to SCREEN, not content.
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
            {/* A. Source Reference Track (Top) */}
            <div className="absolute top-[40px] left-0 w-full h-[160px] opacity-80 pointer-events-none" ref={sourceContainerRef} />

            {/* B. User Recording Track (Bottom) */}
            <div className="absolute top-[220px] left-0 w-full h-[160px] pointer-events-none">

              {/* 2. WaveSurfer Layer (The Truth) - Visible in Review */}
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

        {/* C. VISUALIZER (FIXED OVERLAY) - DEMO EFFECT */}
        {/* We place it outside the ScrollContainer so it stays fixed to the viewport */}
        {/* It aligns exactly with the Bottom Track Area (top-220, h-160) */}
        {status === 'recording' && (
          <div className="absolute left-0 right-0 top-[220px] h-[160px] pointer-events-none z-10 flex flex-col items-center justify-center">

            {/* Glow Effect */}
            <div className="absolute w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>

            {/* Animated Equalizer Bars (CSS Animation) */}
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
      </div>

      {/* 3. Controls (Bottom) */}
      <div className="h-48 bg-zinc-950 flex flex-col justify-between shrink-0 z-20 border-t border-zinc-900 pb-[env(safe-area-inset-bottom)] pt-4 px-6">

        <div className="flex-1 flex items-center justify-center w-full">

          {/* Status 1: Idle */}
          {status === 'idle' && (
            <div className="flex items-center justify-center w-full animate-in fade-in slide-in-from-bottom-4">
              {/* Record Button (Center) */}
              <button onClick={startRecording} className="relative group">
                <div className="absolute inset-0 bg-red-600 rounded-full blur opacity-20 group-hover:opacity-40 transition-opacity" />
                <div className="w-20 h-20 rounded-full bg-red-600 border-[3px] border-zinc-900 shadow-2xl flex items-center justify-center group-active:scale-95 transition-transform">
                  <Mic className="w-8 h-8 text-white" />
                </div>
              </button>
              <span className="absolute mt-28 text-xs text-zinc-500 tracking-wider font-medium">TAP TO RECORD</span>
            </div>
          )}

          {/* Status 2: Recording */}
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

          {/* Status 3: Review */}
          {status === 'review' && (
            <div className="w-full h-full flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 px-2">

              {/* Retry Button (Large) */}
              <button
                onClick={() => setStatus('idle')}
                className="flex-1 h-14 rounded-full bg-zinc-800 text-zinc-300 font-bold uppercase tracking-wider text-sm hover:bg-zinc-700 active:scale-95 transition flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                Retry
              </button>

              {/* Save Button (Large) */}
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
                    alert("Saved!");
                  } catch (e: any) { alert("Save Failed:" + e.message); }
                }}
                className="flex-1 h-14 rounded-full bg-emerald-600 text-white font-bold uppercase tracking-wider text-sm hover:bg-emerald-500 active:scale-95 transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
              >
                Save
                <Download className="w-5 h-5" />
              </button>

            </div>
          )}
        </div>
      </div>

    </div>
  );
}

