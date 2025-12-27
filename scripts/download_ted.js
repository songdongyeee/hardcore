#!/usr/bin/env node

/**
 * TED 音频下载工具 (支持批量下载)
 * 
 * 使用方法:
 * 1. 下载单个链接: node scripts/download_ted.js "https://www.ted.com/talks/..."
 * 2. 批量下载多个链接: node scripts/download_ted.js "url1" "url2" "url3"
 * 3. 从文件批量下载: node scripts/download_ted.js ./urls.txt
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// 配置
const CONFIG = {
    outputDir: './downloads/ted_audio',
    // yt-dlp 提取音频的相关参数
    ytDlpArgs: [
        '--extract-audio',
        '--audio-format', 'm4a',
        '--audio-quality', '0', // 0 为最高质量
        '--output', '%(title)s.%(ext)s',
        '--no-playlist'
    ]
};

/**
 * 运行命令行工具并实时输出
 */
function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`\n🚀 运行: ${command} ${args.join(' ')}`);

        const child = spawn(command, args, {
            ...options,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`命令执行失败，退出码: ${code}`));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * 下载单个音频
 */
async function downloadAudio(url, outputDir) {
    try {
        console.log(`\n正在处理: ${url}`);

        await runCommand('yt-dlp', [
            ...CONFIG.ytDlpArgs,
            '--output', `${path.join(outputDir, '%(title)s.%(ext)s')}`,
            url
        ]);

        console.log(`✅ 下载完成`);
        return { success: true, url };
    } catch (error) {
        console.error(`❌ 下载失败: ${url}`);
        console.error(`   错误信息: ${error.message}`);
        return { success: false, url, error: error.message };
    }
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('\n📖 使用方法:');
        console.log('  node scripts/download_ted.js <URL1> [URL2] ...');
        console.log('  node scripts/download_ted.js <urls_file.txt>');
        console.log('\n示例:');
        console.log('  node scripts/download_ted.js "https://www.ted.com/talks/example"');
        process.exit(0);
    }

    // 确定下载列表
    let urls = [];

    // 检查第一个参数是否是文件
    if (args.length === 1 && fs.existsSync(args[0]) && fs.lstatSync(args[0]).isFile()) {
        const content = fs.readFileSync(args[0], 'utf-8');
        urls = content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && (line.startsWith('http://') || line.startsWith('https://')));
        console.log(`📂 从文件读取了 ${urls.length} 个链接`);
    } else {
        urls = args.filter(arg => arg.startsWith('http://') || arg.startsWith('https://'));
        console.log(`🔗 命令行接收到 ${urls.length} 个链接`);
    }

    if (urls.length === 0) {
        console.error('❌ 未找到有效的链接');
        process.exit(1);
    }

    // 创建输出目录
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        console.log(`📁 创建目录: ${CONFIG.outputDir}`);
    }

    console.log('\n✨ 开始批量下载...');
    console.log('='.repeat(60));

    const results = [];
    for (const url of urls) {
        const result = await downloadAudio(url, CONFIG.outputDir);
        results.push(result);
    }

    // 总结
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 下载总结:');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`  成功: ${successful.length}`);
    console.log(`  失败: ${failed.length}`);

    if (failed.length > 0) {
        console.log('\n❌ 失败列表:');
        failed.forEach(f => console.log(`  - ${f.url}: ${f.error}`));
    }

    console.log(`\n📁 所有音频保存在: ${path.resolve(CONFIG.outputDir)}\n`);
}

main().catch(error => {
    console.error('💥 脚本崩溃:', error);
    process.exit(1);
});
