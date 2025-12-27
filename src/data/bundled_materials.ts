import type { Material } from "./types";
import type { TranscriptSegment } from "./transcript";

// ==========================================
// 1. 把从脚本生成的 raw data 粘贴到这里
// ==========================================
const RAW_DATA_INPUT: any[] = [
    // 示例格式:
    // {
    //   fileName: "Business_L3_Title.m4a", 
    //   folder: "daily_spark",
    //   duration: "05:32",
    //   transcriptRaw: { ... }
    // },

    // 👇 在下面粘贴脚本生成的对象 👇


];

// ==========================================
// 2. 内置材料的手动配置 (封面图、分类等)
// Key 必须和文件名(不含扩展名)一致
// ==========================================
const MANUAL_CONFIG: Record<string, Partial<Material>> = {
    // 示例: 为某个文件配置封面
    // "Business_L3_Title": {
    //    coverUrl: "/images/custom.webp",
    //    tags: { topic: "Leadership", difficulty: "L3", duration: "05:32" }
    // }
};


// ==========================================
// 3. 自动解析逻辑 (不要修改)
// ==========================================
function parseAliyun(jsonStr: string | object): TranscriptSegment[] {
    try {
        const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        let root = Array.isArray(data) ? data[0] : data;
        const sentences = root.sentences || [];

        return sentences.map((s: any) => ({
            start: (s.begin_time || 0) / 1000,
            end: (s.end_time || 0) / 1000,
            text: s.text,
            translation: s.translation,
            words: s.words?.map((w: any) => ({
                text: w.text,
                start: (w.begin_time || 0) / 1000,
                end: (w.end_time || 0) / 1000
            })) || []
        }));
    } catch (e) {
        console.warn("Parse failed", e);
        return [];
    }
}

// 自动计算时长 (MM:SS)
function calculateDuration(segments: TranscriptSegment[]): string {
    if (!segments || segments.length === 0) return "00:00";
    const last = segments[segments.length - 1];
    const totalSeconds = Math.ceil(last.end);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 简易音节计数器 (Heuristic)
function countSyllables(word: string): number {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const syllables = word.match(/[aeiouy]{1,2}/g);
    return syllables ? syllables.length : 1;
}

// 自动计算难度 (Hybrid: ARI + 词汇复杂度)
function calculateDifficulty(segments: TranscriptSegment[]): 'L1' | 'L2' | 'L3' {
    if (!segments || segments.length === 0) return 'L1';

    let charCount = 0;
    let wordCount = 0;
    let sentenceCount = segments.length;
    let complexWordCount = 0;

    segments.forEach(seg => {
        const cleanText = seg.text.replace(/[^a-zA-Z]/g, '');
        charCount += cleanText.length;

        const words = seg.text.trim().split(/\s+/);
        words.forEach(w => {
            const cleanWord = w.replace(/[^a-zA-Z]/g, '');
            if (!cleanWord) return;
            wordCount++;
            if (countSyllables(cleanWord) >= 3) {
                complexWordCount++;
            }
        });
    });

    if (wordCount === 0 || sentenceCount === 0) return 'L1';

    const ari = 4.71 * (charCount / wordCount) + 0.5 * (wordCount / sentenceCount) - 21.43;
    const complexRatio = complexWordCount / wordCount;
    const weightedScore = ari + (complexRatio * 20);

    if (weightedScore < 10) return 'L1';
    if (weightedScore < 15) return 'L2';
    return 'L3';
}

// 自动解析文件名元数据
// 约定格式: 主题_难度_标题.m4a (例如: Business_L2_Title.m4a)
function parseFilenameMeta(fileName: string) {
    const nameNoExt = fileName.replace(/\.[^/.]+$/, "");
    const parts = nameNoExt.split(/[-_]/);

    let topic: string | undefined = undefined;
    let difficulty: any = null; // 默认为null，交给算法
    let title = nameNoExt;

    if (parts.length >= 3) {
        const potentialDiff = parts[1].toUpperCase();
        if (['L1', 'L2', 'L3'].includes(potentialDiff)) {
            topic = parts[0];
            difficulty = potentialDiff;
            title = parts.slice(2).join(" ");
        } else {
            // 如果中间不是难度，则第一个还是主题
            topic = parts[0];
            title = parts.slice(1).join(" ");
        }
    } else if (parts.length === 2) {
        topic = parts[0];
        title = parts[1];
    }

    return { topic, difficulty, title, nameNoExt };
}

// 4. 生成最终列表
const GENERATED_MATERIALS: Material[] = RAW_DATA_INPUT.map((item, index) => {
    const { topic, difficulty: manualDiff, title, nameNoExt } = parseFilenameMeta(item.fileName || `Material_${index}.m4a`);
    const manual = MANUAL_CONFIG[nameNoExt] || {};

    const transcript = parseAliyun(item.transcriptRaw);

    const duration = (item.duration && item.duration !== "00:00")
        ? item.duration
        : calculateDuration(transcript);

    const finalDifficulty = (manualDiff as 'L1' | 'L2' | 'L3') || calculateDifficulty(transcript);

    const folder = item.folder || 'misc';
    const supportedLocation = folder === 'daily_spark' ? 'daily_spark' : 'core_library';

    return {
        id: `bundled-${nameNoExt}`,
        source: 'bundled',
        location: supportedLocation,
        title: manual.title || title,
        subtitle: manual.subtitle || '',

        audioUrl: `/materials/audio/${folder}/${item.fileName}`,
        coverUrl: manual.coverUrl || `/images/${nameNoExt}.webp`,

        transcript: transcript,
        waveform_data: item.waveformData, // 从脚本生成的原材料中读取波形数据
        tags: manual.tags || {
            topic: topic,
            difficulty: finalDifficulty,
            duration: duration
        },
        ...manual
    };
});

// 5. 合并旧的静态数据 (如果你还想保留原来的示例)
export const BUNDLED_MATERIALS: Material[] = [
    // Removed bundled-1 (Steve Jobs) since we're using remote materials now
    ...GENERATED_MATERIALS
];
