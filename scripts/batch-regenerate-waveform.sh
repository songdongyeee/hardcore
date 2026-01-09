#!/bin/bash
# 批量重新生成波形数据
# 使用方法: ./batch-regenerate-waveform.sh

cd /www/pocketbase

# 从 PocketBase 获取所有记录 ID（可以根据需要过滤）
# 这里以 Daily Spark 为例，如果要重新生成所有记录，去掉 filter 参数

echo "🚀 开始批量重新生成波形..."

# 方式1: 重新生成所有记录（慎用！）
# for id in $(node -e "
#   const PocketBase = require('pocketbase');
#   const pb = new PocketBase('http://127.0.0.1:8090');
#   (async () => {
#     const records = await pb.collection('transcripts').getFullList();
#     records.forEach(r => console.log(r.id));
#   })();
# "); do
#   echo "处理: $id"
#   node scripts/retry-waveform.js "$id"
#   sleep 0.5  # 避免过载
# done

# 方式2: 只重新生成特定条件的记录（推荐）
# 例如：只重新生成 Daily Spark 的记录
echo "请使用以下命令之一："
echo ""
echo "1. 重新生成单个记录："
echo "   node scripts/retry-waveform.js <record_id>"
echo ""
echo "2. 重新生成多个记录（手动指定ID列表）："
echo "   for id in id1 id2 id3; do node scripts/retry-waveform.js \$id; sleep 0.5; done"
echo ""
echo "3. 查询并重新生成所有 Daily Spark 记录："
echo "   见下方 Node.js 脚本"
echo ""

cat << 'EOF'
// 创建文件: scripts/batch-regenerate.js
const PocketBase = require('pocketbase');

const pb = new PocketBase('http://127.0.0.1:8090');
const { spawn } = require('child_process');

async function batchRegenerate() {
    try {
        // 获取所有需要重新生成的记录
        // 可以添加 filter 参数过滤条件
        const records = await pb.collection('transcripts').getFullList({
            // filter: 'category="daily_spark"',  // 只处理 Daily Spark
            sort: '-created',
        });

        console.log(`📊 找到 ${records.length} 条记录`);

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            console.log(`[${i + 1}/${records.length}] 处理: ${record.id}`);

            // 调用 retry-waveform.js
            await new Promise((resolve, reject) => {
                const proc = spawn('node', ['scripts/retry-waveform.js', record.id]);
                
                proc.stdout.on('data', (data) => console.log(data.toString()));
                proc.stderr.on('data', (data) => console.error(data.toString()));
                
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Exit code: ${code}`));
                });
            });

            // 避免过载，等待 500ms
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ 批量重新生成完成！');
    } catch (err) {
        console.error('❌ 错误:', err);
    }
}

batchRegenerate();
EOF
