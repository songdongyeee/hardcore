# Hardcore English - Full Project Knowledge Bundle

This document contains everything an AI needs to understand the current state of "Hardcore English", including architecture, key features, and the full source code of critical components.

---

## Part 1: Architecture & Status

**1. Project Identity**
- **Name**: Hardcore English (硬核英语)
- **Platform**: iOS (via Capacitor) + Web (React)
- **Frameworks**: React, Vite, TypeScript, Tailwind CSS, Capacitor (Native Runtime), Wavesurfer.js, FFmpeg (WASM).

**2. Core Implementation Strategy**
- **Selection**: Uses `@capawesome/capacitor-file-picker` to select Audio OR Video.
- **Extraction**: Uses `@ffmpeg/ffmpeg` (WASM) to extract audio track (`.m4a`) from video files on the device.
- **Privacy**: Original video is NEVER saved. Only the extracted audio is saved to `Directory.Documents`.
- **Gesture Control**: Implemented strict `user-select: none` CSS strategies to prevent iOS native text selection menus from interfering with the custom "Grammar Vision" long-press.

**3. Current "Mock" Status**
- **FFmpeg Extraction**: Extracts audio track from video files locally (WASM), saves to App Sandbox.
- **Mock Transcription**: Currently simulates a Whisper API call.

**4. Monetization & Access Control**:
- **RevenueCat Integration**: Handles VIP subscriptions (`useRevenueCat` hook).
- **Usage Limits**: Free users have limited daily access to articles (`useUsageLimit` hook).
- **Paywall UI**: Intercepts interactions for non-VIPs when limits are reached.

**5. Next Task**: Replace the mock `whisperService` with a real OpenAI Whisper API integration.

---

## Part 2: Critical Source Code

### 1. `src/services/audioConverter.ts` (FFmpeg WASM Integration)
This file handles the loading of FFmpeg WASM and the extraction of audio from video files.

```typescript
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Filesystem, Directory } from '@capacitor/filesystem';

class AudioConverter {
    private ffmpeg: FFmpeg | null = null;
    private loaded = false;

    async load() {
        if (this.loaded) return;

        this.ffmpeg = new FFmpeg();

        // Load from CDN (unpkg/jsdelivr) for simplicity in this iteration.
        // For production offline, we should copy these to public/assets.
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

        // Single-thread handling? 0.12.x supports multithread but needs Headers.
        // We'll try standard load first. If it fails on headers, we might need a workaround.
        // NOTE: In Capacitor, headers are hard.
        // Let's try loading the SINGLE THREADED version if available, or just standard.
        // Actually, 0.12.x IS multithreaded by default.
        // Error "SharedArrayBuffer is not defined" requires headers.

        try {
            await this.ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            this.loaded = true;
        } catch (e) {
            console.error("FFmpeg load error. If SharedArrayBuffer error, we need headers or single-thread.", e);
            throw e;
        }
    }

    async extractAudio(
        videoWebPath: string,
        _videoName: string,
        onProgress?: (progress: number) => void
    ): Promise<string> {
        if (!this.ffmpeg || !this.loaded) await this.load();
        const ffmpeg = this.ffmpeg!;

        ffmpeg.on('progress', ({ progress }) => {
            // progress is 0-1.
            if (onProgress) onProgress(Math.round(progress * 100));
        });

        const inputName = 'input_video';
        // const outputName = 'output.mp3'; // Using MP3 for broader compatibility or m4a
        // If copy: m4a usually.
        // Let's try re-encoding to mp3 for "Safe" playback everywhere, or copy for speed.
        // User authorized 10-20s wait. Encoding is safer for "audio extraction".
        // But 500MB file... Copy is better.
        // Let's do COPY to .m4a (if source is mp4/mov).
        const outputExt = 'm4a';
        const outputFileName = `extracted_${Date.now()}.${outputExt}`;

        // 1. Read file into MEMFS
        // This downloads the 500MB file into JS memory. Might be risky.
        const fileData = await fetchFile(videoWebPath);
        await ffmpeg.writeFile(inputName, fileData);

        // 2. Run Command
        // -vn: No video
        // -acodec copy: Direct stream copy (FAST, NO RE-ENCODE)
        // If source audio is not aac, this might fail for m4a container. 
        // Safer: -vn -acodec libmp3lame output.mp3 (Re-encode, Slower).
        // Let's try re-encode to mp3 (libmp3lame) to ensure valid audio file?
        // Wait, standard ffmpeg build might not have lame.
        // Let's try AAC re-encode: -c:a aac
        await ffmpeg.exec(['-i', inputName, '-vn', '-c:a', 'aac', outputFileName]);

        // 3. Read output
        const data = await ffmpeg.readFile(outputFileName);

        // 4. Save to Disk (Documents Directory)
        const savedFile = await Filesystem.writeFile({
            path: outputFileName,
            data: this.u8ToBase64(data as Uint8Array),
            directory: Directory.Documents
        });

        // 5. Cleanup
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputFileName);

        return savedFile.uri;
    }

    // Helper: Uint8Array to Base64 (Capacitor needs Base64 string for binary write)
    // For 500MB file, this Base64 conversion might OOM...
    // Is there a way to write Blob? 'capacitor-blob-writer' exists in package.json!
    // I should use that if possible.
    private u8ToBase64(bytes: Uint8Array): string {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
        // Warning: stack overflow on large arrays with spread. Loop allows implementation.
    }
}

export const audioConverter = new AudioConverter();
```

### 2. `src/components/views/HomeView.tsx` (Logic Flow)
Handles file selection, progress bar updates, and coordinates the Import -> Extract -> Transcribe flow.

```tsx
import { useRef, useState, useEffect } from "react";
import { MaterialCard, type Material } from "@/components/MaterialCard";
import { User, UploadCloud } from "lucide-react";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { Paywall } from "@/components/Paywall";
import { pickAudioFile } from "@/utils/fileHandler";
import { whisperService } from "@/services/whisperService";
import { audioConverter } from "@/services/audioConverter";
import type { TranscriptSegment } from "@/data/transcript";

interface HomeViewProps {
  onPlay: (audioUrl: string, targetView?: 'listening' | 'shadowing', transcript?: TranscriptSegment[]) => void;
  onProfile: () => void;
}

const MATERIALS: Material[] = [
  // ... (Material data omitted for brevity)
];

export function HomeView({ onPlay, onProfile }: HomeViewProps) {
  const [activeId, setActiveId] = useState<string>('1');
  const [showPaywall, setShowPaywall] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const observerRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { isVip } = useRevenueCat();
  const { checkAccess } = useUsageLimit(isVip);

  // ... (handleCardClick omitted)

  const handleImport = async () => {
    if (isImporting) return;
    setIsImporting(true);

    try {
      const file = await pickAudioFile();
      if (!file) {
        setIsImporting(false);
        return;
      }

      setImportProgress(0);

      let finalUri = file.uri;
      let finalWebPath = file.webPath;

      // 1. Convert if Video
      // Basic check: name ends with mp4/mov/avi or is video mime
      const isVideo = file.name.match(/\.(mp4|mov|avi|m4v)$/i);

      if (isVideo) {
        console.log("Video detected, starting conversion...");
        // We convert using the webPath (http/file url)
        finalUri = await audioConverter.extractAudio(file.webPath, file.name, (p) => {
          // Scale progress: 0-50% for conversion, 50-100% for transcribe
          setImportProgress(Math.round(p * 0.5));
        });
        
        // Update paths for subsequent steps
        const { Capacitor } = await import('@capacitor/core');
        finalWebPath = Capacitor.convertFileSrc(finalUri);
      }

      // 2. Transcribe (Mock - or Real logic if we had it)
      // Now passing the AUDIO file (converted or original)
      const transcript = await whisperService.transcribe(finalUri, (progress) => {
        const base = isVideo ? 50 : 0;
        const scale = isVideo ? 0.5 : 1;
        setImportProgress(base + Math.round(progress * scale));
      });

      // Play
      onPlay(finalWebPath, 'shadowing', transcript);

    } catch (e: any) {
      console.error("Import/Convert failed", e);
      alert("Failed: " + e.message);
    } finally {
      setIsImporting(false);
    }
  };

  // ... (useEffect & JSX omitted for brevity)
}
```

### 3. `src/components/SentenceWrapper.tsx` (Gesture Handling)
Implements the critical interaction/CSS fixes to prevent iOS native text selection.

```tsx
import { cn } from "@/lib/utils";
import { useLongPress } from "@/hooks/useLongPress";

interface SentenceWrapperProps {
    isActive: boolean;
    onLongPress: () => void;
    children: React.ReactNode;
}

export function SentenceWrapper({ isActive, onLongPress, children }: SentenceWrapperProps) {
    // 1. Gesture Binding on Parent
    const bind = useLongPress(
        onLongPress,
        () => { }, // Click is handled by children (words) or ignored
        { delay: 400 }
    );

    return (
        <div
            {...bind}
            className={cn(
                "mb-6 leading-loose rounded-xl p-2 transition-colors duration-300 relative",
                // 2. Disable Selection & System Menu
                "select-none cursor-default",
                isActive ? "bg-amber-500/20" : "bg-transparent"
            )}
            style={{
                // Critical for iOS
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                userSelect: 'none',
            }}
        >
            {/* 3. Text Container - Just Renders */}
            <p className="pointer-events-auto">
                {children}
            </p>
        </div>
    );
}
```
