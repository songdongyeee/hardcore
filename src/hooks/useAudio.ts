import { useRef, useState, useEffect } from 'react';

export function useAudio(src: string, enabled: boolean = false) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () => console.error("Audio error:", audio.error);

    audio.addEventListener('timeupdate', updateTime);
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
      audio.pause();
      audio.removeEventListener('timeupdate', updateTime);
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
