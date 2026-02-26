#!/bin/bash
# 步骤 3: 部署后端钩子到服务器

echo "📦 步骤 3: 部署后端钩子"
echo "================================"
echo ""

# 服务器信息（请根据实际情况修改）
SERVER_USER="root"
SERVER_HOST="zjcnex.top"
SERVER_PB_PATH="/www/pocketbase/pb_hooks"

echo "🎯 目标服务器: $SERVER_USER@$SERVER_HOST"
echo "📁 PocketBase 路径: $SERVER_PB_PATH"
echo ""

# 1. 备份现有钩子
echo "1️⃣ 备份现有钩子..."
ssh $SERVER_USER@$SERVER_HOST "cd $SERVER_PB_PATH && cp aliyun_asr.pb.js aliyun_asr.pb.js.backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo '无需备份（文件不存在）'"

# 2. 上传新钩子
echo ""
echo "2️⃣ 上传双引擎钩子..."
scp pb_hooks/dual_engine_asr.pb.js $SERVER_USER@$SERVER_HOST:$SERVER_PB_PATH/aliyun_asr.pb.js

# 3. 重启 PocketBase
echo ""
echo "3️⃣ 重启 PocketBase..."
ssh $SERVER_USER@$SERVER_HOST "pm2 restart pocketbase"

echo ""
echo "✅ 部署完成！"
echo ""
echo "📋 验证步骤："
echo "   1. 检查 PM2 状态: ssh $SERVER_USER@$SERVER_HOST 'pm2 status'"
echo "   2. 查看日志: ssh $SERVER_USER@$SERVER_HOST 'pm2 logs pocketbase --lines 20'"
