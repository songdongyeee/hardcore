const fs = require('fs');
const path = require('path');

// ==========================================
// 参数配置
// ==========================================
const TARGET_DIR = process.argv[2] || './public/audio'; // 默认处理 ./public/audio
const IS_DRY_RUN = !process.argv.includes('--execute'); // 默认 Dry Run，除非带 --execute

console.log(`\n🚀 开始重命名任务`);
console.log(`📂 目标目录: ${path.resolve(TARGET_DIR)}`);
console.log(`⚠️  模式: ${IS_DRY_RUN ? '【模拟预览 (Dry Run)】' : '【正式执行 (EXECUTE)】'}`);
console.log(`------------------------------------------\n`);

if (!fs.existsSync(TARGET_DIR)) {
    console.error(`❌ 错误: 目录不存在 "${TARGET_DIR}"`);
    process.exit(1);
}

// 匹配模式: ESL Lesson on XXX (1).m4a
// 捕获 XXX 部分
const pattern = /^ESL Lesson on\s+(.+?)\s+\(\d+\)(\.[a-zA-Z0-9]+)$/i;

let count = 0;
let matchCount = 0;

const files = fs.readdirSync(TARGET_DIR);

files.forEach(file => {
    const match = file.match(pattern);
    if (match) {
        matchCount++;
        const topic = match[1];
        const ext = match[2];
        const newName = `Listen A Minute - ${topic}${ext}`;

        const oldPath = path.join(TARGET_DIR, file);
        const newPath = path.join(TARGET_DIR, newName);

        if (IS_DRY_RUN) {
            console.log(`[PREVIEW] "${file}" -> "${newName}"`);
        } else {
            try {
                fs.renameSync(oldPath, newPath);
                console.log(`[SUCCESS] "${file}" -> "${newName}"`);
                count++;
            } catch (err) {
                console.error(`[ERROR] 无法重命名 "${file}": ${err.message}`);
            }
        }
    }
});

console.log(`\n------------------------------------------`);
if (IS_DRY_RUN) {
    console.log(`🔍 扫描完成: 发现 ${matchCount} 个符合条件的文件。`);
    console.log(`💡 提示: 确认预览无误后，运行 \`node scripts/rename_esl.js --execute\` 执行修改。`);
} else {
    console.log(`✅ 执行完成: 成功重命名 ${count} / ${matchCount} 个文件。`);
}
