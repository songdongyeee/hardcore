#!/usr/bin/env node
/**
 * 🔄 Retry Waveform Generation
 * 手动将指定记录ID添加到波形生成队列
 * 
 * 用法: node scripts/retry-waveform.js <recordId>
 */

import Bull from 'bull';

const REDIS_URL = 'redis://127.0.0.1:6379';
const QUEUE_NAME = 'waveform-generation';

async function retryWaveform(recordId) {
    if (!recordId) {
        console.error('❌ 用法: node retry-waveform.js <recordId>');
        process.exit(1);
    }

    console.log('📤 发送任务到队列...');
    console.log(`   Record ID: ${recordId}`);

    const queue = new Bull(QUEUE_NAME, REDIS_URL);

    try {
        const job = await queue.add({
            recordId: recordId,
            timestamp: Date.now()
        });

        console.log('✅ 任务已添加到队列！');
        console.log(`   Job ID: ${job.id}`);
        console.log('\n💡 查看处理日志: pm2 logs waveform-worker');

        await queue.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ 发送失败:', error.message);
        await queue.close();
        process.exit(1);
    }
}

// 获取命令行参数
const recordId = process.argv[2];
retryWaveform(recordId);
