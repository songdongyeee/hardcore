import PocketBase from 'pocketbase';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from 'music-metadata';
import { spawn } from 'child_process';

// --- Configuration ---
const PB_URL = 'https://zjcnex.top';
const INPUT_DIR = './raw_materials';
const OUTPUT_FILE = './src/data/generated_bundled_data.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to generate waveform peaks locally using ffmpeg
// Helper to generate waveform peaks locally using ffmpeg (Consistent with waveform-worker.js)
async function getWaveformData(audioPath, durationSeconds) {
    return new Promise((resolve, reject) => {
        // Peaks per second (PPS) determines resolution. 
        // App typically renders ~30-50 peaks per second for smooth scrolling.
        // Worker uses 30.
        const peaksPerSec = 30;
        const totalPeaks = Math.max(Math.floor(durationSeconds * peaksPerSec), 100);

        console.log(`   🌊 Generating ${totalPeaks} peaks using FFmpeg...`);

        // Use FFmpeg to extract PCM data (same logic as worker)
        const ffmpegCmd = `ffmpeg -i "${audioPath}" -f s16le -acodec pcm_s16le -ar 44100 -ac 1 - 2>/dev/null`;
        const ffmpeg = spawn('sh', ['-c', ffmpegCmd]);

        const chunks = [];

        ffmpeg.stdout.on('data', (chunk) => {
            chunks.push(chunk);
        });

        ffmpeg.on('close', (code) => {
            if (code !== 0) {
                // If ffmpeg fails, fallback to simple generation or reject
                console.warn(`   ⚠️ FFmpeg failed (code ${code}), falling back to mock.`);
                // Fallback logic could go here, but for now let's just resolve empty or mock
                const mock = [];
                for (let i = 0; i < totalPeaks; i++) mock.push([0, Math.floor(Math.random() * 100)]);
                return resolve(mock);
            }

            try {
                const pcmBuffer = Buffer.concat(chunks);
                const samples = [];
                for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
                    const low = pcmBuffer[i];
                    const high = pcmBuffer[i + 1];
                    const sample = (high << 8) | low;
                    const signedSample = sample > 32767 ? sample - 65536 : sample;
                    // Normalize to -1.0 to 1.0
                    samples.push(signedSample / 32768.0);
                }

                // Downsample to peaks
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

                // Global Normalization (0-255 range, same as app expects)
                const globalMax = Math.max(...rawPeaks);
                const peaks = rawPeaks.map(peak => {
                    if (globalMax === 0) return [0, 0];
                    const normalized = (peak / globalMax) * 255;
                    // Noise gate: < 3 => 0
                    const final = normalized < 3 ? 0 : Math.round(normalized);
                    return [0, final]; // Format [min, max] but min is typically 0 for visualization
                });

                console.log(`   ✅ Generated ${peaks.length} normalized peaks`);
                resolve(peaks);

            } catch (err) {
                console.error("Error parsing PCM:", err);
                resolve([]);
            }
        });

        ffmpeg.on('error', (err) => {
            console.error("FFmpeg spawn error:", err);
            resolve([]);
        });
    });
}

async function main() {
    console.log("🚀 Starting Batch Processor...");

    const pb = new PocketBase(PB_URL);

    console.log("🔑 Logging in...");
    const email = '993789049@qq.com';
    const password = 'Zhouji107178';

    let loggedIn = false;

    // Strategy: Legacy Admin Login (For PB version < 0.23)
    try {
        console.log("   尝试兼容模式登录 (Legacy Admin Path)...");
        // Using manual send to bypass SDK version-specific path mapping
        const authData = await pb.send('/api/admins/auth-with-password', {
            method: 'POST',
            body: {
                identity: email,
                password: password,
            },
        });

        // Manual save to authStore
        pb.authStore.save(authData.token, authData.admin);
        console.log("✅ Legacy Admin Login Success!");
        loggedIn = true;
    } catch (e) {
        console.log(`   ❌ Legacy Admin Failed: ${e.status} - ${e.message}`);

        // Fallback: Post-0.23 Superuser
        try {
            console.log("   尝试新版超级用户登录 (Strategy: _superusers)...");
            await pb.collection('_superusers').authWithPassword(email, password);
            console.log("✅ Superuser Login Success!");
            loggedIn = true;
        } catch (e2) {
            console.log(`   ❌ Superuser Failed: ${e2.status} - ${e2.message}`);

            // Fallback: Regular User
            try {
                console.log("   尝试普通用户登录 (Strategy: Users Collection)...");
                await pb.collection('users').authWithPassword(email, password);
                console.log("✅ User Login Success!");
                loggedIn = true;
            } catch (e3) {
                console.log(`   ❌ User Login Failed: ${e3.status} - ${e3.message}`);
            }
        }
    }

    if (!loggedIn) {
        console.error("\n❌ 所有方式均无法登录。");
        console.log("请确认你是否在 PocketBase 后台修改了管理员邮箱或密码。");
        process.exit(1);
    }

    const baseDir = path.resolve(process.cwd(), INPUT_DIR);
    const folders = ['daily_spark', 'core_library'];
    let allFiles = [];

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir);
        folders.forEach(f => fs.mkdirSync(path.join(baseDir, f)));
        console.log(`📁 Created input structure at ${INPUT_DIR}`);
        console.log(`   Please put audio files into '${INPUT_DIR}/daily_spark' or '${INPUT_DIR}/core_library'`);
        return;
    }

    for (const folder of folders) {
        const subDir = path.join(baseDir, folder);
        if (fs.existsSync(subDir)) {
            const files = fs.readdirSync(subDir)
                .filter(f => f.endsWith('.m4a') || f.endsWith('.mp3'))

                .map(f => ({
                    name: f,
                    path: path.join(subDir, f),
                    folder: folder
                }));
            allFiles = allFiles.concat(files);
        } else {
            fs.mkdirSync(subDir);
        }
    }

    if (allFiles.length === 0) {
        console.log("⚠️ No audio files found in subfolders of " + INPUT_DIR);
        console.log("   Put files in ./raw_materials/daily_spark/ or ./raw_materials/core_library/");
        return;
    }

    console.log(`Found ${allFiles.length} files. Processing...`);

    const results = [];

    for (const fileObj of allFiles) {
        const { name: fileName, path: filePath, folder } = fileObj;
        console.log(`\nProcessing [${folder}]: ${fileName} ...`);

        // Extract precise duration using music-metadata
        let duration = "00:00";
        let metadata = null;

        try {
            metadata = await parseFile(filePath);
            const totalSeconds = Math.floor(metadata.format.duration || 0);
            const mins = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            duration = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            console.log(`   ⏱️  Duration detected: ${duration}`);
        } catch (e) {
            console.warn(`   ⚠️  Duration extraction failed, using 00:00`);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const blob = new Blob([fileBuffer]);

        // Generate Waveform before upload
        console.log(`   🌊 Generating Waveform...`);
        const totalSeconds = metadata?.format?.duration ? Math.floor(metadata.format.duration) : 60; // Fallback to 60s
        const waveform = await getWaveformData(filePath, totalSeconds);

        // Parse filename metadata (similar to App logic)
        const nameNoExt = fileName.replace(/\.[^/.]+$/, "");
        const parts = nameNoExt.split(/[-_]/).map(p => p.trim());
        let topic = 'General';
        let difficulty = 'L1'; // Default
        let parsedTitle = nameNoExt;

        if (parts.length >= 3) {
            const potentialDiff = parts[1].toUpperCase();
            if (['L1', 'L2', 'L3'].includes(potentialDiff)) {
                topic = parts[0];
                difficulty = potentialDiff;
                parsedTitle = parts.slice(2).join(" ");
            } else {
                topic = parts[0];
                parsedTitle = parts.slice(1).join(" ");
            }
        } else if (parts.length === 2) {
            topic = parts[0];
            parsedTitle = parts[1];
        }

        const formData = new FormData();
        formData.append('audio', blob, fileName);
        formData.append('title', parsedTitle);
        formData.append('duration', duration);
        formData.append('topic', topic);
        formData.append('difficulty', difficulty);
        formData.append('location', folder); // 'daily_spark' or 'core_library'
        formData.append('language', 'en');
        formData.append('waveform_data', JSON.stringify(waveform));
        formData.append('status', 'processing');
        // 🔥 STATUS: 'private' means it won't be seen by users until you update it in PB
        const VISIBILITY = 'private';
        formData.append('visibility', VISIBILITY);

        try {
            const record = await pb.collection('transcripts').create(formData);
            console.log(`   ✅ Uploaded (ID: ${record.id}). Waiting for ASR...`);

            let retries = 0;
            let finalRecord = null;
            while (retries < 60) {
                await new Promise(r => setTimeout(r, 2000));
                const current = await pb.collection('transcripts').getOne(record.id);
                if (current.status === 'done') {
                    finalRecord = current;
                    break;
                }
                if (current.status === 'error') {
                    console.error("   ❌ Server reported error in processing.");
                    break;
                }
                process.stdout.write('.');
                retries++;
            }

            if (finalRecord) {
                console.log("\n   ✨ Transcription Complete!");

                results.push({
                    fileName,
                    folder,
                    duration,
                    topic,
                    difficulty,
                    id: finalRecord.id,
                    title: finalRecord.title,
                    language: 'en',
                    transcriptRaw: finalRecord.text,
                    waveformData: finalRecord.waveform_data // 🚀 确保波形数据被保存到本地代码库
                });

            } else {
                console.error("\n   ❌ Timeout waiting for ASR.");
            }

        } catch (e) {
            console.error(`   ❌ Failed to process ${fileName}`, e);
        }
    }

    console.log("\n💾 Generating Output File...");

    // 使用压缩格式，不再使用 null, 2 缩进
    const minifiedData = JSON.stringify(results);
    const tsContent = `export const GENERATED_BATCH_DATA = ${minifiedData};`;

    fs.writeFileSync(OUTPUT_FILE, tsContent);
    console.log(`✅ Done! Data saved to ${OUTPUT_FILE}`);
    console.log(`🚀 Line count reduced by minifying JSON.`);
}

main();
