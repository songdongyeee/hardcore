const PocketBase = require('pocketbase');
const { spawn } = require('child_process');

const pb = new PocketBase('http://127.0.0.1:8090');

async function batchRegenerate() {
    try {
        console.log('🔍 正在查询需要重新生成的记录...');

        // 获取所有需要重新生成的记录
        // 可以添加 filter 参数指定条件
        const records = await pb.collection('transcripts').getFullList({
            // filter: 'category="daily_spark"',  // 取消注释以只处理 Daily Spark
            // filter: 'created<"2026-01-05"',    // 或只处理某个日期之前的
            sort: '-created',
        });

        console.log(`📊 找到 ${records.length} 条记录\n`);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            console.log(`[${i + 1}/${records.length}] 处理: ${record.id}`);

            try {
                // 调用 retry-waveform.js
                await new Promise((resolve, reject) => {
                    const proc = spawn('node', ['scripts/retry-waveform.js', record.id]);

                    let output = '';
                    proc.stdout.on('data', (data) => {
                        output += data.toString();
                    });

                    proc.stderr.on('data', (data) => {
                        console.error(`  ⚠️  ${data.toString().trim()}`);
                    });

                    proc.on('close', (code) => {
                        if (code === 0) {
                            console.log(`  ✅ ${output.trim()}`);
                            resolve();
                        } else {
                            reject(new Error(`Exit code: ${code}`));
                        }
                    });
                });

                successCount++;
            } catch (err) {
                console.error(`  ❌ 失败: ${err.message}`);
                failCount++;
            }

            // 避免过载，等待 500ms
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('\n' + '='.repeat(50));
        console.log('📊 批量处理完成！');
        console.log(`✅ 成功: ${successCount} 条`);
        console.log(`❌ 失败: ${failCount} 条`);
        console.log('='.repeat(50));
    } catch (err) {
        console.error('❌ 错误:', err);
    }
}

batchRegenerate();
