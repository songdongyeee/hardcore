#!/usr/bin/env node
/**
 * 🌊 Waveform Generation Worker
 * 消费 Redis 队列中的任务，异步生成音频波形数据
 */

import Bull from 'bull';
import PocketBase from 'pocketbase';
import { spawn } from 'child_process';

// ═══════════════════════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    pbUrl: 'https://zjcnex.top',
    email: '993789049@qq.com',
    password: 'Zhouji107178',
    redisUrl: 'redis://127.0.0.1:6379',
    concurrency: 2,  // 并发数：同时处理2个任务
};

// ═══════════════════════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════════════════════

const pb = new PocketBase(CONFIG.pbUrl);
const queue = new Bull('waveform-generation', CONFIG.redisUrl);

// ═══════════════════════════════════════════════════════════════════════════════
// 波形生成逻辑（带全局归一化）
// ═══════════════════════════════════════════════════════════════════════════════

async function generateWaveform(audioPath, durationSeconds) {
    return new Promise((resolve, reject) => {
        const peaksPerSec = 30;
        const totalPeaks = Math.floor(durationSeconds * peaksPerSec);

        console.log(`  🌊 Generating ${totalPeaks} peaks using FFmpeg...`);

        // 使用 FFmpeg 提取 PCM 数据
        const ffmpegCmd = `ffmpeg -i "${audioPath}" -f s16le -acodec pcm_s16le -ar 44100 -ac 1 - 2>/dev/null`;
        const ffmpeg = spawn('sh', ['-c', ffmpegCmd]);

        const chunks = [];

        ffmpeg.stdout.on('data', (chunk) => {
            chunks.push(chunk);
        });

        ffmpeg.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`FFmpeg exited with code ${code}`));
            }

            try {
                const pcmBuffer = Buffer.concat(chunks);

                // 解析 PCM 样本
                const samples = [];
                for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
                    const low = pcmBuffer[i];
                    const high = pcmBuffer[i + 1];
                    const sample = (high << 8) | low;
                    const signedSample = sample > 32767 ? sample - 65536 : sample;
                    samples.push(signedSample / 32768.0);
                }

                console.log(`  🌊 Parsed ${samples.length} samples`);

                // 下采样到峰值
                const blockSize = Math.floor(samples.length / totalPeaks);
                const rawPeaks = [];

                for (let i = 0; i < totalPeaks; i++) {
                    let max = 0;
                    for (let j = 0; j < blockSize; j++) {
                        const idx = (i * blockSize) + j;
                        if (idx < samples.length) {
                            const absSample = Math.abs(samples[idx]);
                            if (absSample > max) max = absSample;
                        }
                    }
                    rawPeaks.push(max);
                }

                // 全局归一化：确保所有发音（无论音量大小）都清晰可见
                const globalMax = Math.max(...rawPeaks);
                console.log(`  🎚️  Global max: ${globalMax.toFixed(4)}`);

                const peaks = rawPeaks.map(peak => {
                    if (globalMax === 0) return [0, 0];
                    const normalized = (peak / globalMax) * 255;
                    // 设置噪音阈值：低于3的认为是静音
                    const final = normalized < 3 ? 0 : Math.round(normalized);
                    return [0, final];
                });

                console.log(`  🌊 ✅ Generated ${peaks.length} normalized peaks`);
                resolve(peaks);
            } catch (err) {
                reject(err);
            }
        });

        ffmpeg.on('error', reject);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 任务处理器
// ═══════════════════════════════════════════════════════════════════════════════

async function processWaveformJob(job) {
    const { recordId } = job.data;
    console.log(`\n📊 Processing waveform for record: ${recordId}`);

    try {
        // 1. 获取记录
        const record = await pb.collection('transcripts').getOne(recordId);
        console.log(`  ✅ Record found: ${record.title || record.audio}`);

        // 2. 提取音频时长
        const durationStr = record.duration;
        let duration = 0;

        if (typeof durationStr === 'string' && durationStr.includes(':')) {
            const parts = durationStr.split(':');
            duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        } else {
            duration = parseFloat(durationStr) || 0;
        }

        if (duration === 0) {
            throw new Error('Duration is 0 or invalid');
        }

        console.log(`  ⏱️  Duration: ${duration} seconds`);

        // 3. 构建音频文件路径
        const audioName = record.audio;
        const collectionId = 'qh2eb7na42zaxjk';  // transcripts collection ID
        const audioPath = `/www/pocketbase/pb_data/storage/${collectionId}/${recordId}/${audioName}`;

        console.log(`  🎵 Audio path: ${audioPath}`);

        // 4. 生成波形
        const peaks = await generateWaveform(audioPath, duration);

        // 5. 更新记录
        await pb.collection('transcripts').update(recordId, {
            waveform_data: peaks
        });

        console.log(`  ✅ Waveform saved to PocketBase`);
        return { success: true, peakCount: peaks.length };

    } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        throw error;  // 让 Bull 处理重试
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 启动 Worker
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('🚀 Waveform Worker Starting...');
    console.log(`   Redis: ${CONFIG.redisUrl}`);
    console.log(`   PocketBase: ${CONFIG.pbUrl}`);
    console.log(`   Concurrency: ${CONFIG.concurrency}\n`);

    // 登录 PocketBase（兼容所有版本）
    try {
        const authData = await pb.send('/api/admins/auth-with-password', {
            method: 'POST',
            body: {
                identity: CONFIG.email,
                password: CONFIG.password,
            },
        });
        pb.authStore.save(authData.token, authData.admin);
        console.log('✅ Logged in to PocketBase as admin\n');
    } catch (e) {
        console.error('❌ Admin login failed:', e.message);
        console.error('   Email:', CONFIG.email);
        console.error('   Please verify credentials in waveform-worker.js\n');
        process.exit(1);
    }

    // 配置队列处理器
    queue.process(CONFIG.concurrency, async (job) => {
        return await processWaveformJob(job);
    });

    // 事件监听
    queue.on('completed', (job, result) => {
        console.log(`✅ Job ${job.id} completed! Peaks: ${result.peakCount}\n`);
    });

    queue.on('failed', (job, err) => {
        console.error(`❌ Job ${job.id} failed: ${err.message}\n`);
    });

    queue.on('error', (error) => {
        console.error('Queue error:', error);
    });

    console.log('👂 Worker is listening for jobs...\n');
}

// 优雅退出
process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, closing worker...');
    await queue.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, closing worker...');
    await queue.close();
    process.exit(0);
});

// 启动
main().catch((error) => {
    console.error('💥 Worker failed to start:', error);
    process.exit(1);
});
