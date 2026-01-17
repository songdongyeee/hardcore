import { useRef, useState, useEffect } from 'react';

export function useAudio(src: string, enabled: boolean = false) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    // 🔥 性能优化：降低更新频率以减少手机发热
    // 从 60fps 降到 ~15fps（每66ms更新一次），足够流畅且省电
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 100; // 100ms = 10fps (优化：减少WebView桥接开销)

    const updateTimeLoop = () => {
      if (audio && !audio.paused) {
        const now = performance.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          setCurrentTime(audio.currentTime);
          lastUpdateTime = now;
        }
        // ✅ 只在播放时继续RAF循环
        rafRef.current = requestAnimationFrame(updateTimeLoop);
      } else {
        // ✅ 暂停时停止RAF，避免CPU空转
        rafRef.current = null;
      }
    };

    const updateDuration = () => setDuration(audio.duration);
    const onPlay = () => {
      setIsPlaying(true);
      // Start high-frequency updates when playing
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastUpdateTime = 0; // Reset to update immediately
      rafRef.current = requestAnimationFrame(updateTimeLoop);
    };
    const onPause = () => {
      setIsPlaying(false);
      // Stop updates when paused
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onError = () => console.error("Audio error:", audio.error);

    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    // Initial play if enabled
    if (enabled) {
      audio.play().catch(e => console.log("Auto-play blocked:", e));
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [src]);

  // Reactive Play/Pause based on enabled prop
  useEffect(() => {
    if (audioRef.current) {
      if (enabled && audioRef.current.paused) {
        audioRef.current.play().catch(e => console.log("Reactive play failed:", e));
      } else if (!enabled && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    }
  }, [enabled]);

  const togglePlay = async () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        try {
          await audioRef.current.play();
        } catch (err) {
          console.error("Playback failed:", err);
          // Optional: Notify user via state if needed, but console is start
        }
      }
    }
  };

  const seek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time); // Update state immediately for UI responsiveness
    }
  };

  const play = async () => {
    try {
      await audioRef.current?.play();
    } catch (err) {
      console.error("Playback failed:", err);
    }
  };

  const pause = () => {
    audioRef.current?.pause();
  };

  return { isPlaying, currentTime, duration, togglePlay, play, pause, seek, audioRef };
}
