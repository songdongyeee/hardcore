#!/usr/bin/env node
/**
 * 🚀 Queue API Server
 * 接收 HTTP 请求并添加任务到 Bull 队列
 * 端口: 3001
 */

import express from 'express';
import Bull from 'bull';

const app = express();
app.use(express.json());

const REDIS_URL = 'redis://127.0.0.1:6379';
const queue = new Bull('waveform-generation', REDIS_URL);

// 添加任务到队列
app.post('/add-waveform-task', async (req, res) => {
    try {
        const { recordId } = req.body;

        if (!recordId) {
            return res.status(400).json({ error: 'recordId is required' });
        }

        const job = await queue.add({
            recordId: recordId,
            timestamp: Date.now()
        });

        console.log(`✅ Added job ${job.id} for record: ${recordId}`);
        res.json({ success: true, jobId: job.id });
    } catch (error) {
        console.error('❌ Error adding job:', error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
app.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 Queue API running on http://127.0.0.1:${PORT}`);
});
