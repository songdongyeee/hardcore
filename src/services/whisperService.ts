import PocketBase from 'pocketbase';
import type { TranscriptSegment } from "@/data/transcript";

// ⚠️ Ensure this matches your server IP
const PB_URL = "https://zjcnex.top";

export const whisperService = {
    transcribe: async (fileBlob: Blob, fileName: string, onProgress?: (progress: number) => void): Promise<TranscriptSegment[]> => {
        console.log("🚀 Starting upload to PocketBase:", fileName);
        if (onProgress) onProgress(10);

        try {
            const pb = new PocketBase(PB_URL);

            // 1. Create FormData
            const formData = new FormData();
            formData.append("audio", fileBlob, fileName);
            formData.append("status", "pending");

            if (onProgress) onProgress(30);

            // 2. Upload to 'transcripts' collection
            console.log("📤 Uploading...");
            const record = await pb.collection('transcripts').create(formData);
            console.log("✅ Upload success, Record ID:", record.id);

            if (onProgress) onProgress(40);

            // 3. Subscribe to changes (Realtime)
            return new Promise(async (resolve, reject) => {
                let isFinished = false;

                const checkStatus = (r: any) => {
                    if (isFinished) return;
                    console.log("🔄 Status Update:", r.status);

                    if (r.status === 'processing') {
                        if (onProgress) onProgress(60);
                    }
                    if (r.status === 'done') {
                        isFinished = true;
                        console.log("✅ Transcription Done!");
                        if (onProgress) onProgress(95);
                        cleanup();

                        try {
                            const segments = JSON.parse(r.text) as TranscriptSegment[];
                            if (onProgress) onProgress(100);
                            resolve(segments);
                        } catch (parseErr) {
                            if (onProgress) onProgress(100);
                            resolve([{ start: 0, end: 0, text: r.text, words: [] }]);
                        }
                    }
                    if (r.status === 'error') {
                        isFinished = true;
                        console.error("❌ Transcription Failed on Server:", r.text);
                        cleanup();
                        reject(new Error("Server Error: " + r.text));
                    }
                };

                const unsubscribeFunc = await pb.collection('transcripts').subscribe(record.id, (e) => {
                    checkStatus(e.record);
                });

                const cleanup = () => {
                    unsubscribeFunc();
                };

                // CRITICAL: Check status immediately in case we missed the event
                try {
                    const currentRecord = await pb.collection('transcripts').getOne(record.id);
                    checkStatus(currentRecord);
                } catch (e) {
                    console.warn("Initial status check failed", e);
                }

                // timeout safety (60s)
                setTimeout(() => {
                    if (!isFinished) {
                        isFinished = true;
                        cleanup();
                        reject(new Error("Timeout waiting for server transcription"));
                    }
                }, 60000);
            });

        } catch (err: any) {
            console.error("❌ Upload/Network Error:", err);
            // Better debugging: show full error object
            const errMsg = err?.data ? JSON.stringify(err.data) : (err.message || JSON.stringify(err));
            alert("Upload Error: " + errMsg);
            throw err;
        }
    }
};
