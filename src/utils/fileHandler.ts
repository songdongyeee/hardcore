import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';

export interface AudioFileResult {
    uri: string;
    name: string;
    webPath: string;
    duration?: number;
    size?: number; // Size in bytes
}

export async function pickAudioFile(): Promise<AudioFileResult | null> {
    try {
        const result = await FilePicker.pickFiles({
            types: [
                'audio/mpeg', 'audio/aac', 'audio/m4a', 'audio/wav', 'audio/mp3',
                'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/avi'
            ],
            readData: false, // We only need the path
        });

        if (!result.files || result.files.length === 0) {
            return null;
        }

        const file = result.files[0];

        // Convert to Web Friendly URL immediately
        // Note: file.path is the native path (e.g., file://...)
        // file.webPath might be provided by the picker, but Capacitor.convertFileSrc is safest for file://
        const nativePath = file.path || '';
        const webPath = Capacitor.convertFileSrc(nativePath);

        return {
            uri: nativePath, // Keep native path for Whisper
            name: file.name,
            webPath: webPath, // Use this for Wavesurfer
            size: file.size
        };
    } catch (e) {
        console.error("File Picker Error:", e);
        // User might have cancelled
        return null;
    }
}
