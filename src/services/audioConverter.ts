import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Filesystem, Directory } from '@capacitor/filesystem';
import writeBlob from 'capacitor-blob-writer';

class AudioConverter {
    private ffmpeg: FFmpeg | null = null;
    private loaded = false;

    async load() {
        if (this.loaded) return;

        this.ffmpeg = new FFmpeg();

        // Load from LOCAL assets (Downloaded in previous step)
        // This ensures offline capability and stability
        const baseURL = '/assets/ffmpeg';

        try {
            await this.ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            this.loaded = true;
        } catch (e) {
            console.error("FFmpeg load error.", e);
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
        // We use m4a (AAC) for efficient storage
        const outputExt = 'm4a';
        const outputFileName = `extracted_${Date.now()}.${outputExt}`;

        // 1. Read file into MEMFS
        const fileData = await fetchFile(videoWebPath);
        await ffmpeg.writeFile(inputName, fileData);

        // 2. Run Command (Extract Audio Track)
        // -vn: No video
        // -c:a aac: Re-encode to AAC (Targeting m4a container)
        await ffmpeg.exec(['-i', inputName, '-vn', '-c:a', 'aac', outputFileName]);

        // 3. Read output
        const data = await ffmpeg.readFile(outputFileName); // data is FileData (Uint8Array | string)
        const u8Data = data as Uint8Array; // Assert it's Uint8Array

        // 4. Save to Disk (Documents Directory) using BlobWriter (OOM Safe)
        // Passing u8Data directly works for Blob/UInt8Array
        // Force cast buffer to any to avoid strict SharedArrayBuffer checks
        const blob = new Blob([u8Data.buffer as any], { type: 'audio/m4a' });

        // Use capacitor-blob-writer to stream write
        await writeBlob({
            path: outputFileName,
            directory: Directory.Documents,
            blob: blob,
            recursive: true
        });

        // Get the URI for the saved file
        const uriResult = await Filesystem.getUri({
            path: outputFileName,
            directory: Directory.Documents
        });

        // 5. Cleanup
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputFileName);

        return uriResult.uri;
    }
}

export const audioConverter = new AudioConverter();
