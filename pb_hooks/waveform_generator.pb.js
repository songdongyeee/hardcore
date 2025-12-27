/// <reference path="../pb_data/types.d.ts" />

/**
 * 波形生成器
 * 使用ffmpeg从音频文件生成压缩波形数据
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * 使用ffmpeg生成压缩波形数据
 * @param {string} audioPath - 音频文件绝对路径
 * @param {number} duration - 音频时长（秒）
 * @returns {Promise<Array<Array<number>>>} 压缩波形数据 [[0, 128], [0, 200], ...]
 */
function generateCompressedWaveform(audioPath, duration) {
    const peaksPerSec = 30;  // 30峰值/秒，平衡质量和大小
    const totalPeaks = Math.floor(duration * peaksPerSec);

    console.log(`[WaveformGen] Generating ${totalPeaks} peaks for ${duration.toFixed(1)}s audio`);

    return new Promise((resolve, reject) => {
        // 使用ffmpeg提取PCM数据
        const command = `ffmpeg -i "${audioPath}" -f s16le -acodec pcm_s16le -ar 44100 -ac 1 pipe:1`;

        exec(command, {
            encoding: 'buffer',
            maxBuffer: 200 * 1024 * 1024  // 200MB buffer
        }, (error, stdout, stderr) => {
            if (error) {
                console.error('[WaveformGen] FFmpeg error:', error.message);
                reject(error);
                return;
            }

            try {
                // 解析PCM数据
                const samples = [];
                for (let i = 0; i < stdout.length; i += 2) {
                    const sample = stdout.readInt16LE(i) / 32768.0;  // 归一化到-1到1
                    samples.push(sample);
                }

                console.log(`[WaveformGen] Parsed ${samples.length} samples`);

                // 降采样生成峰值
                const blockSize = Math.floor(samples.length / totalPeaks);
                const peaks = [];

                for (let i = 0; i < totalPeaks; i++) {
                    let max = 0;

                    for (let j = 0; j < blockSize; j++) {
                        const idx = (i * blockSize) + j;
                        if (idx < samples.length) {
                            const sample = samples[idx];
                            if (Math.abs(sample) > max) {
                                max = Math.abs(sample);
                            }
                        }
                    }

                    // 压缩：转换为0-255整数
                    const compressedMax = Math.round(max * 255);
                    peaks.push([0, compressedMax]);
                }

                console.log(`[WaveformGen] Generated ${peaks.length} peaks, size: ${(JSON.stringify(peaks).length / 1024).toFixed(1)} KB`);
                resolve(peaks);
            } catch (parseError) {
                console.error('[WaveformGen] Parse error:', parseError);
                reject(parseError);
            }
        });
    });
}

// 导出供其他Hook使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateCompressedWaveform
    };
}
