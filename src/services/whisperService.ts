import type { TranscriptSegment } from "@/data/transcript";

// Mock Service for now
// In the future, replace this with actual Whisper Plugin call
export const whisperService = {
    transcribe: async (nativeFilePath: string, onProgress?: (progress: number) => void): Promise<TranscriptSegment[]> => {
        console.log("Transcribing file at:", nativeFilePath);

        // Simulate processing delay with progress
        const totalSteps = 20;
        for (let i = 0; i <= totalSteps; i++) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms * 20 = 2s total
            if (onProgress) onProgress(Math.round((i / totalSteps) * 100));
        }

        // Return a generic mock transcript
        // Ideally, we would parse the audio or use a real service
        // For now, we return a fun "Analysis" transcript
        return [
            { start: 0.0, end: 2.0, text: "Wait..." },
            { start: 2.0, end: 5.0, text: "I am analyzing this custom audio file you uploaded." },
            { start: 5.0, end: 10.0, text: "The content seems to be incredibly dense and rich with information." },
            { start: 10.0, end: 15.0, text: "Here is where the speaker makes a profound point about life and technology." },
            { start: 15.0, end: 20.0, text: "You should definitely practice shadowing this section repeatedly." },
            { start: 20.0, end: 25.0, text: "End of analysis. Great job importing this!" }
        ].map(seg => {
            // Generate word-level timestamps (mock)
            const words = seg.text.split(' ');
            const duration = seg.end - seg.start;
            const wordDuration = duration / words.length;
            return {
                ...seg,
                words: words.map((word, i) => ({
                    text: word,
                    start: seg.start + (i * wordDuration),
                    end: seg.start + ((i + 1) * wordDuration)
                }))
            };
        });
    }
};
