#!/bin/bash
# 批量重新生成所有 Daily Spark 的波形
# 使用方法：上传到服务器后执行 bash regenerate-daily-spark.sh

cd /www/pocketbase

echo "🔍 正在获取所有 Daily Spark 记录（支持分页）..."

# 初始化
all_ids=""
page=1
total_items=0

# 循环获取所有页
while true; do
    echo "📄 正在获取第 $page 页..."
    
    response=$(curl -s "http://127.0.0.1:8090/api/collections/transcripts/records?filter=category=\"daily_spark\"&perPage=200&page=$page")
    
    # 提取当前页的 ID
    page_ids=$(echo "$response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    # 如果当前页没有数据，退出循环
    if [ -z "$page_ids" ]; then
        echo "✅ 已获取所有页，共 $((page - 1)) 页"
        break
    fi
    
    # 累加 ID
    all_ids="$all_ids $page_ids"
    
    # 统计当前页数量
    page_count=$(echo "$page_ids" | wc -w | tr -d ' ')
    total_items=$((total_items + page_count))
    echo "   本页: $page_count 条"
    
    # 下一页
    page=$((page + 1))
    
    # 避免过快请求
    sleep 0.2
done

echo ""
echo "📊 总共找到 $total_items 条 Daily Spark 记录"
echo ""

# 逐个处理
current=0
success=0
fail=0

for id in $all_ids; do
    current=$((current + 1))
    echo "[$current/$total_items] 处理: $id"
    
    if node scripts/retry-waveform.js "$id"; then
        success=$((success + 1))
    else
        fail=$((fail + 1))
    fi
    
    # 避免过载
    sleep 1
done

echo ""
echo "=========================================="
echo "📊 批量处理完成！"
echo "✅ 成功: $success 条"
echo "❌ 失败: $fail 条"
echo "=========================================="

echo ""
echo "=========================================="
echo "📊 批量处理完成！"
echo "✅ 成功: $success 条"
echo "❌ 失败: $fail 条"
echo "=========================================="
