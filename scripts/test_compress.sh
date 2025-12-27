#!/bin/bash

# 图片压缩快速测试脚本
# 这个脚本会创建一个测试文件夹，帮助你快速验证压缩效果

echo "🧪 图片压缩测试工具"
echo "================================"
echo ""

# 进入项目目录
cd "$(dirname "$0")/.."

echo "📋 使用说明："
echo ""
echo "方式 1: 快速测试（推荐）"
echo "  将你的图片放到任意文件夹，然后运行："
echo "  node scripts/compress_images.js [你的图片文件夹] [输出文件夹]"
echo ""
echo "方式 2: 使用示例"
echo "  node scripts/compress_images.js ~/Downloads/photos ~/Downloads/photos_compressed"
echo ""
echo "================================"
echo ""

read -p "是否现在就压缩图片？(y/n): " answer

if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    echo ""
    read -p "请输入图片文件夹的完整路径: " input_path
    
    if [ -z "$input_path" ]; then
        echo "❌ 路径不能为空"
        exit 1
    fi
    
    if [ ! -d "$input_path" ]; then
        echo "❌ 文件夹不存在: $input_path"
        exit 1
    fi
    
    # 自动生成输出路径
    output_path="${input_path}_compressed"
    
    echo ""
    echo "📁 输入: $input_path"
    echo "📁 输出: $output_path"
    echo ""
    echo "开始压缩..."
    echo ""
    
    # 运行压缩脚本
    node scripts/compress_images.js "$input_path" "$output_path"
    
    echo ""
    echo "✅ 完成！"
    echo "压缩后的图片保存在: $output_path"
    echo ""
    
    read -p "是否打开输出文件夹查看？(y/n): " open_folder
    if [ "$open_folder" = "y" ] || [ "$open_folder" = "Y" ]; then
        open "$output_path"
    fi
else
    echo ""
    echo "💡 提示："
    echo "当你准备好图片后，运行以下命令："
    echo "  cd /Users/geo/Downloads/hardcoreEnglish"
    echo "  node scripts/compress_images.js [输入文件夹] [输出文件夹]"
    echo ""
fi
