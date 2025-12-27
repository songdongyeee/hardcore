#!/usr/bin/env node

/**
 * 批量压缩图片脚本 - 针对手机大卡片显示优化
 * 
 * 特点:
 * - 自动调整尺寸到适合手机显示的宽度（默认 1200px）
 * - 高质量压缩，保持清晰度的同时减小文件体积
 * - 支持 jpg, png, webp 格式
 * - 自动转换为 WebP 格式以获得最佳压缩比
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// 配置参数
const CONFIG = {
    // 目标宽度（像素）- 适合手机大卡片显示
    targetWidth: 1200,

    // WebP 质量（1-100）- 85 是清晰度和文件大小的最佳平衡点
    webpQuality: 85,

    // JPEG 质量（如果需要保留 jpg 格式）
    jpegQuality: 85,

    // 输入文件夹
    inputDir: './images',

    // 输出文件夹
    outputDir: './images_compressed',

    // 支持的输入格式
    supportedFormats: ['.jpg', '.jpeg', '.png', '.webp'],

    // 输出格式 ('webp' | 'jpeg' | 'original')
    outputFormat: 'webp'
};

/**
 * 压缩单个图片
 */
async function compressImage(inputPath, outputPath) {
    try {
        const ext = path.extname(inputPath).toLowerCase();
        const basename = path.basename(inputPath, ext);

        // 读取图片元数据
        const metadata = await sharp(inputPath).metadata();
        console.log(`\n处理: ${path.basename(inputPath)}`);
        console.log(`  原始尺寸: ${metadata.width}x${metadata.height}`);
        console.log(`  原始大小: ${(fs.statSync(inputPath).size / 1024).toFixed(2)} KB`);

        // 创建 sharp 实例
        let image = sharp(inputPath);

        // 如果图片宽度大于目标宽度，则调整尺寸
        if (metadata.width > CONFIG.targetWidth) {
            image = image.resize(CONFIG.targetWidth, null, {
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        // 根据配置选择输出格式
        let outputFilePath = outputPath;

        if (CONFIG.outputFormat === 'webp') {
            // 转换为 WebP 格式
            outputFilePath = path.join(
                path.dirname(outputPath),
                basename + '.webp'
            );

            await image
                .webp({
                    quality: CONFIG.webpQuality,
                    effort: 6 // 0-6，6 为最佳压缩（较慢）
                })
                .toFile(outputFilePath);

        } else if (CONFIG.outputFormat === 'jpeg') {
            // 转换为 JPEG 格式
            outputFilePath = path.join(
                path.dirname(outputPath),
                basename + '.jpg'
            );

            await image
                .jpeg({
                    quality: CONFIG.jpegQuality,
                    mozjpeg: true // 使用 mozjpeg 以获得更好的压缩
                })
                .toFile(outputFilePath);

        } else {
            // 保留原始格式
            if (ext === '.jpg' || ext === '.jpeg') {
                await image
                    .jpeg({
                        quality: CONFIG.jpegQuality,
                        mozjpeg: true
                    })
                    .toFile(outputFilePath);
            } else if (ext === '.png') {
                await image
                    .png({
                        quality: CONFIG.webpQuality,
                        compressionLevel: 9
                    })
                    .toFile(outputFilePath);
            } else if (ext === '.webp') {
                await image
                    .webp({
                        quality: CONFIG.webpQuality,
                        effort: 6
                    })
                    .toFile(outputFilePath);
            }
        }

        // 获取压缩后的文件信息
        const outputMetadata = await sharp(outputFilePath).metadata();
        const outputSize = fs.statSync(outputFilePath).size;
        const inputSize = fs.statSync(inputPath).size;
        const reduction = ((1 - outputSize / inputSize) * 100).toFixed(2);

        console.log(`  压缩后尺寸: ${outputMetadata.width}x${outputMetadata.height}`);
        console.log(`  压缩后大小: ${(outputSize / 1024).toFixed(2)} KB`);
        console.log(`  文件减小: ${reduction}%`);
        console.log(`  ✅ 完成`);

        return {
            success: true,
            inputPath,
            outputPath: outputFilePath,
            reduction: parseFloat(reduction),
            inputSize,
            outputSize
        };

    } catch (error) {
        console.error(`  ❌ 错误: ${error.message}`);
        return {
            success: false,
            inputPath,
            error: error.message
        };
    }
}

/**
 * 批量压缩文件夹中的所有图片
 */
async function compressDirectory(inputDir, outputDir) {
    // 创建输出文件夹
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 读取输入文件夹
    const files = fs.readdirSync(inputDir);

    // 筛选支持的图片格式
    const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return CONFIG.supportedFormats.includes(ext);
    });

    if (imageFiles.length === 0) {
        console.log(`❌ 在 ${inputDir} 中没有找到支持的图片文件`);
        return;
    }

    console.log(`\n找到 ${imageFiles.length} 个图片文件`);
    console.log('开始压缩...\n');
    console.log('='.repeat(60));

    // 统计信息
    const results = [];

    // 压缩每个图片
    for (const file of imageFiles) {
        const inputPath = path.join(inputDir, file);
        const outputPath = path.join(outputDir, file);

        const result = await compressImage(inputPath, outputPath);
        results.push(result);
    }

    // 打印总结
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 压缩总结:');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`  成功: ${successful.length} 个文件`);
    console.log(`  失败: ${failed.length} 个文件`);

    if (successful.length > 0) {
        const totalInputSize = successful.reduce((sum, r) => sum + r.inputSize, 0);
        const totalOutputSize = successful.reduce((sum, r) => sum + r.outputSize, 0);
        const totalReduction = ((1 - totalOutputSize / totalInputSize) * 100).toFixed(2);

        console.log(`  原始总大小: ${(totalInputSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  压缩后总大小: ${(totalOutputSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  总共减小: ${totalReduction}%`);
    }

    if (failed.length > 0) {
        console.log('\n❌ 失败的文件:');
        failed.forEach(r => {
            console.log(`  - ${path.basename(r.inputPath)}: ${r.error}`);
        });
    }

    console.log(`\n✅ 所有文件已保存到: ${outputDir}\n`);
}

/**
 * 主函数
 */
async function main() {
    // 从命令行参数获取输入和输出文件夹
    const args = process.argv.slice(2);

    let inputDir = CONFIG.inputDir;
    let outputDir = CONFIG.outputDir;

    if (args.length >= 1) {
        inputDir = args[0];
    }

    if (args.length >= 2) {
        outputDir = args[1];
    }

    // 检查输入文件夹是否存在
    if (!fs.existsSync(inputDir)) {
        console.error(`❌ 输入文件夹不存在: ${inputDir}`);
        console.log('\n使用方法:');
        console.log('  node compress_images.js [输入文件夹] [输出文件夹]');
        console.log('\n示例:');
        console.log('  node compress_images.js ./images ./images_compressed');
        process.exit(1);
    }

    console.log('\n🖼️  批量图片压缩工具');
    console.log('='.repeat(60));
    console.log(`📁 输入文件夹: ${inputDir}`);
    console.log(`📁 输出文件夹: ${outputDir}`);
    console.log(`📏 目标宽度: ${CONFIG.targetWidth}px`);
    console.log(`🎨 输出格式: ${CONFIG.outputFormat}`);
    console.log(`⚙️  质量设置: ${CONFIG.outputFormat === 'webp' ? CONFIG.webpQuality : CONFIG.jpegQuality}`);

    await compressDirectory(inputDir, outputDir);
}

// 运行主函数
main().catch(console.error);
