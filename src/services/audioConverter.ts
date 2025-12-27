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

    /**
     * Extracts audio from video, optionally limiting duration.
     * Always returns an .m4a (AAC) URI.
     */
    async extractAudio(
        videoWebPath: string,
        _videoName: string,
        onProgress?: (progress: number) => void,
        limitDuration?: number
    ): Promise<string> {
        if (!this.ffmpeg || !this.loaded) await this.load();
        const ffmpeg = this.ffmpeg!;

        ffmpeg.on('progress', ({ progress }) => {
            if (onProgress) onProgress(Math.round(progress * 100));
        });

        const inputName = 'input_video';
        const outputExt = 'm4a';
        const outputFileName = `extracted_${Date.now()}.${outputExt}`;

        const fileData = await fetchFile(videoWebPath);
        await ffmpeg.writeFile(inputName, fileData);

        // Build command: -i input [-t duration] -vn -c:a aac -b:a 128k output.m4a
        const cmd = ['-i', inputName];
        if (limitDuration) {
            cmd.push('-t', limitDuration.toString());
        }
        cmd.push('-vn', '-c:a', 'aac', '-b:a', '128k', outputFileName);

        await ffmpeg.exec(cmd);

        const data = await ffmpeg.readFile(outputFileName);
        const u8Data = data as Uint8Array;

        const blob = new Blob([u8Data.buffer as any], { type: 'audio/m4a' });

        await writeBlob({
            path: outputFileName,
            directory: Directory.Documents,
            blob: blob,
            recursive: true
        });

        const uriResult = await Filesystem.getUri({
            path: outputFileName,
            directory: Directory.Documents
        });

        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputFileName);

        return uriResult.uri;
    }

    /**
     * Clips an existing audio file to a certain duration.
     * Also transcodes to m4a (AAC) to ensure consistency and compression.
     */
    async clipAudio(
        audioWebPath: string,
        limitDuration: number,
        onProgress?: (progress: number) => void
    ): Promise<string> {
        return this.extractAudio(audioWebPath, 'audio', onProgress, limitDuration);
    }
}

export const audioConverter = new AudioConverter();
