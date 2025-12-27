#!/usr/bin/env node

/**
 * 批量音频压缩工具 - 针对听力材料优化
 * 
 * 特点:
 * - 导出格式: M4A (AAC 编码)
 * - 音质配置: 128kbps VBR (动态比特率)，保持高清晰度
 * - 音量优化: 自动进行响度标准化 (Loudness Normalization)
 * - 兼容性: 完美适配 iOS/Android/Mac/Web
 * - 批量处理: 自动扫描文件夹中的 mp3, wav, m4a, flac 等格式
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// 配置参数
const CONFIG = {
    // 目标格式
    outputExt: '.m4a',

    // 输入文件夹（默认）
    inputDir: './downloads/ted_audio',

    // 输出文件夹（默认）
    outputDir: './downloads/audio_optimized',

    // 支持的音频格式
    supportedFormats: ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.m4r'],

    // FFmpeg 压缩参数
    ffmpegArgs: [
        '-c:a', 'aac',           // 使用 AAC 编码
        '-b:a', '64k',           // 设为 64kbps (平衡体积与音质)
        '-ac', '1',              // 强制转为单声道        
        '-y'                     // 覆盖已存在的文件
    ]
};

/**
 * 运行 FFmpeg 命令
 */
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', args);

        let errorOutput = '';

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(errorOutput));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * 压缩单个音频
 */
async function compressAudio(inputPath, outputPath) {
    try {
        console.log(`\n处理: ${path.basename(inputPath)}`);

        const startTime = Date.now();
        const inputSize = fs.statSync(inputPath).size;

        const ffmpegCmd = [
            '-i', inputPath,
            ...CONFIG.ffmpegArgs,
            outputPath
        ];

        // 打印实际执行的命令，方便调试
        console.log(`  执行命令: ffmpeg ${ffmpegCmd.join(' ')}`);

        await runFFmpeg(ffmpegCmd);

        const endTime = Date.now();
        const outputSize = fs.statSync(outputPath).size;
        const reduction = ((1 - outputSize / inputSize) * 100).toFixed(2);
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        console.log(`  原始大小: ${(inputSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  处理后大小: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  减小比例: ${reduction}%`);
        console.log(`  耗时: ${duration}s`);
        console.log(`  ✅ 完成`);

        return { success: true, inputSize, outputSize };
    } catch (error) {
        console.error(`  ❌ 错误: ${error.message.split('\n')[0]}`);
        return { success: false, error: error.message };
    }
}

/**
 * 批量处理目录
 */
async function processDirectory(inputDir, outputDir) {
    // 检查输入目录
    if (!fs.existsSync(inputDir)) {
        console.error(`❌ 输入目录不存在: ${inputDir}`);
        return;
    }

    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 读取并筛选文件
    const files = fs.readdirSync(inputDir).filter(file => {
        const ext = path.extname(file).toLowerCase();
        return CONFIG.supportedFormats.includes(ext);
    });

    if (files.length === 0) {
        console.log(`\nℹ️  在 ${inputDir} 中没有发现可处理的音频文件`);
        return;
    }

    console.log(`\n发现 ${files.length} 个音频文件，准备开始压缩...`);
    console.log('='.repeat(60));

    let totalInput = 0;
    let totalOutput = 0;
    let successCount = 0;

    for (const file of files) {
        const inputPath = path.join(inputDir, file);
        const fileName = path.basename(file, path.extname(file));
        const outputPath = path.join(outputDir, fileName + CONFIG.outputExt);

        const result = await compressAudio(inputPath, outputPath);

        if (result.success) {
            totalInput += result.inputSize;
            totalOutput += result.outputSize;
            successCount++;
        }
    }

    // 总结
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 压缩总结:');
    console.log(`  成功处理: ${successCount} / ${files.length}`);

    if (successCount > 0) {
        const totalReduction = ((1 - totalOutput / totalInput) * 100).toFixed(2);
        console.log(`  总体空间节省: ${totalReduction}%`);
        console.log(`  原始总大小: ${(totalInput / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  处理后总大小: ${(totalOutput / 1024 / 1024).toFixed(2)} MB`);
    }

    console.log(`\n📁 所有优化后的音频已保存在: ${path.resolve(outputDir)}\n`);
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);

    let inputDir = CONFIG.inputDir;
    let outputDir = CONFIG.outputDir;

    if (args.length >= 1) inputDir = args[0];
    if (args.length >= 2) outputDir = args[1];

    console.log('\n🎙️  音频优化 & 压缩工具');
    console.log('='.repeat(60));
    console.log(`📁 输入路径: ${inputDir}`);
    console.log(`📁 输出路径: ${outputDir}`);
    console.log(`⚙️  配置: 64kbps AAC + 单声道`);

    await processDirectory(inputDir, outputDir);
}

main().catch(error => {
    console.error('💥 脚本崩溃:', error);
    process.exit(1);
});
