#!/bin/bash
# 双引擎转写系统 - 快速测试脚本

echo "🧪 双引擎转写系统测试"
echo "================================"

# 1. 检查 Whisper 安装
echo ""
echo "📦 检查 Whisper 环境..."
python3 -c "from faster_whisper import WhisperModel; print('✅ faster-whisper 已安装')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "❌ faster-whisper 未安装"
    echo "   运行: pip3 install faster-whisper"
    exit 1
fi

# 2. 检查配置
echo ""
echo "⚙️  检查 Worker 配置..."
if grep -q "your_admin@example.com" scripts/mac_whisper_worker.py; then
    echo "⚠️  Worker 未配置！"
    echo ""
    echo "请编辑 scripts/mac_whisper_worker.py："
    echo "  - POCKETBASE_URL"
    echo "  - ADMIN_EMAIL"
    echo "  - ADMIN_PASSWORD"
    echo ""
    echo "提示: nano scripts/mac_whisper_worker.py"
    exit 1
else
    echo "✅ Worker 已配置"
fi

# 3. 测试 Worker 连接
echo ""
echo "🔌 测试 PB 连接..."
echo "启动 Worker 测试（Ctrl+C 停止）..."
echo ""

python3 scripts/mac_whisper_worker.py
