/// <reference path="../pb_data/types.d.ts" />

/**
 * Materials Hook
 * 在转写完成后自动生成波形数据
 */

const { generateCompressedWaveform } = require(`${__hooks}/waveform_generator.pb.js`);

// 在材料更新后触发
onRecordAfterUpdateRequest((e) => {
    const record = e.record;

    // 检查是否转写完成且还没有波形数据
    const status = record.get('status');
    const hasWaveform = record.get('waveform_data');

    if (status === 'completed' && !hasWaveform) {
        console.log(`[Materials] Transcription completed for ${record.id}, generating waveform...`);

        // 异步生成波形（不阻塞响应）
        setTimeout(async () => {
            try {
                const audioFile = record.get('audio');
                const duration = record.get('duration');

                if (!audioFile) {
                    console.log(`[Materials] No audio file for ${record.id}, skipping waveform`);
                    return;
                }

                if (!duration || duration === 0) {
                    console.log(`[Materials] No duration for ${record.id}, skipping waveform`);
                    return;
                }

                // 构建音频文件路径
                const collectionId = record.collection().id;
                const recordId = record.id;
                const audioPath = `${__hooks}/pb_data/storage/${collectionId}/${recordId}/${audioFile}`;

                console.log(`[Materials] Generating waveform for ${audioPath}`);

                // 生成压缩波形
                const waveformData = await generateCompressedWaveform(audioPath, duration);

                // 保存到数据库
                record.set('waveform_data', waveformData);
                $app.dao().saveRecord(record);

                console.log(`[Materials] Waveform generated for ${record.id}, ${waveformData.length} peaks`);
            } catch (error) {
                console.error(`[Materials] Failed to generate waveform for ${record.id}:`, error.message);
            }
        }, 0);
    }
}, "transcripts");

console.log('[Materials] Hook loaded');
