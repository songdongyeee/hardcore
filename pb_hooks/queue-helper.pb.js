/**
 * 🚀 Queue Helper for PocketBase Hooks
 * 提供向 Redis 队列发送任务的辅助函数
 */

/**
 * 发送波形生成任务到 Redis 队列
 * @param {string} recordId - PocketBase 记录 ID
 */
function sendWaveformTask(recordId) {
    try {
        // 使用 redis-cli 发送任务到 Bull 队列
        const redisKey = 'bull:waveform-generation:wait';

        // Bull 队列的任务格式
        const jobData = JSON.stringify({
            data: {
                recordId: recordId,
                timestamp: Date.now()
            },
            opts: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                }
            }
        });

        // 使用 $os.exec 执行 redis-cli 命令
        const result = $os.exec('redis-cli', 'RPUSH', redisKey, jobData);

        if (result.code === 0) {
            console.log(`✅ [Queue] Sent waveform task for record: ${recordId}`);
            return true;
        } else {
            console.error(`❌ [Queue] Failed to send task: ${result.stderr}`);
            return false;
        }
    } catch (e) {
        console.error(`❌ [Queue] Error sending task: ${e.message}`);
        return false;
    }
}

// 导出函数供其他 hooks 使用
module.exports = { sendWaveformTask };
