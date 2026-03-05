/**
 * 🤖 AI 口语评价服务
 *
 * 接口设计：前端 Mock 实现，真实接口签名保持一致，后端接入时只需替换 callRealAPI()。
 */

export interface EvaluationDimension {
    key: 'fluency' | 'pronunciation' | 'pace' | 'completeness';
    label: string;
    score: number;    // 0-100
    comment: string;
}

export interface SentenceEvaluation {
    original: string;
    feedback: string;
    score: number;    // 0-100
}

export interface EvaluationResult {
    overallScore: number;
    grade: 'S' | 'A' | 'B' | 'C';  // S≥90, A≥80, B≥70, C<70
    dimensions: EvaluationDimension[];
    sentences: SentenceEvaluation[];
    suggestion: string;
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────
// 🔌 真实后端接口（后端接入时取消注释，并删除 mockEvaluate）
//
// async function callRealAPI(
//   audioBase64: string,
//   mimeType: string,
//   sentences: string[],
//   materialId?: string
// ): Promise<EvaluationResult> {
//   const response = await fetch('/api/evaluate', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ audioBase64, mimeType, sentences, materialId }),
//   });
//   if (!response.ok) throw new Error(`Evaluation API error: ${response.status}`);
//   return response.json();
// }
// ─────────────────────────────────────────────────────────────────

function getGrade(score: number): EvaluationResult['grade'] {
    if (score >= 90) return 'S';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    return 'C';
}

function rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 前端 Mock：模拟真实评价延迟与结构 */
async function mockEvaluate(
    sentences: string[]
): Promise<EvaluationResult> {
    // 模拟网络延迟 1.2 ~ 2s
    await new Promise(r => setTimeout(r, rand(1200, 2000)));

    const dimScores = {
        fluency: rand(70, 95),
        pronunciation: rand(72, 93),
        pace: rand(68, 92),
        completeness: rand(75, 98),
    };

    const overall = Math.round(
        (dimScores.fluency * 0.3 + dimScores.pronunciation * 0.3 + dimScores.pace * 0.2 + dimScores.completeness * 0.2)
    );

    const dimensions: EvaluationDimension[] = [
        {
            key: 'fluency',
            label: '流利度',
            score: dimScores.fluency,
            comment: dimScores.fluency >= 85 ? '语流连贯，停顿自然' : '部分停顿较多，可多加练习',
        },
        {
            key: 'pronunciation',
            label: '发音',
            score: dimScores.pronunciation,
            comment: dimScores.pronunciation >= 85 ? '发音清晰，辅音表现佳' : '个别音节发音偏重，注意弱读',
        },
        {
            key: 'pace',
            label: '语速',
            score: dimScores.pace,
            comment: dimScores.pace >= 85 ? '语速与原文匹配，节奏稳定' : '语速略慢，建议配合原音反复跟读',
        },
        {
            key: 'completeness',
            label: '完整度',
            score: dimScores.completeness,
            comment: dimScores.completeness >= 85 ? '内容覆盖完整，未遗漏关键词' : '部分句子内容有跳跃，注意补全',
        },
    ];

    const sentenceComments = [
        '语调自然，连读处理得很好',
        '节奏稍快，注意句尾降调',
        '发音标准，可以尝试更流畅的语速',
        '停顿位置准确，断句清晰',
        '整体流利，建议强调关键词',
    ];

    const scoredSentences: SentenceEvaluation[] = sentences.slice(0, 5).map((s, i) => ({
        original: s,
        score: rand(65, 98),
        feedback: sentenceComments[i % sentenceComments.length],
    }));

    const suggestions = [
        '整体表现不错！重点练习辅音爆破音（p/b/t/d）的清晰度。',
        '语调曲线基本准确。建议每天配合原声跟读 5 分钟，强化肌肉记忆。',
        '节奏感良好！可以尝试更大声地朗读，帮助找到最自然的音量和气流。',
        '发音已有进步！下一步可关注连读（linking）和吞音（elision）的自然处理。',
    ];

    return {
        overallScore: overall,
        grade: getGrade(overall),
        dimensions,
        sentences: scoredSentences,
        suggestion: suggestions[rand(0, suggestions.length - 1)],
        timestamp: Date.now(),
    };
}

/**
 * 评价录音入口
 *
 * @param audioBase64 - base64 编码的录音数据
 * @param mimeType    - 音频 MIME 类型（如 "audio/aac"）
 * @param sentences   - 对应段落的原文句子数组
 * @param materialId  - 材料 ID（可选，供后端按材料计分）
 */
export async function evaluateRecording(
    audioBase64: string,
    mimeType: string,
    sentences: string[],
    materialId?: string
): Promise<EvaluationResult> {
    void audioBase64; void mimeType; void materialId; // TODO: 后端接入时传给 callRealAPI
    return mockEvaluate(sentences);
}
