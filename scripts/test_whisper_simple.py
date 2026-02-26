#!/usr/bin/env python3
"""
Whisper 转写测试脚本 - 快速验证可行性
用法: python3 test_whisper_simple.py <音频文件路径>
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print("用法: python3 test_whisper_simple.py <音频文件路径>")
        print("示例: python3 test_whisper_simple.py test.mp3")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    
    try:
        # 尝试导入 faster-whisper
        from faster_whisper import WhisperModel
        print("✅ faster-whisper 已安装")
    except ImportError:
        print("❌ faster-whisper 未安装，尝试安装...")
        print("请运行: pip3 install faster-whisper")
        sys.exit(1)
    
    print(f"\n🎙️ 开始转写: {audio_file}")
    print("📦 加载模型: small (首次运行会下载，约 244MB)...")
    
    # 加载模型
    model = WhisperModel("small", device="cpu", compute_type="int8")
    
    # 转写
    print("🔄 转写中...")
    segments, info = model.transcribe(
        audio_file, 
        language="en",
        word_timestamps=True  # 单词级时间戳
    )
    
    print(f"\n✅ 转写完成！")
    print(f"   语言: {info.language}")
    print(f"   概率: {info.language_probability:.2%}")
    print("\n" + "="*60)
    print("转写结果预览:")
    print("="*60 + "\n")
    
    # 收集所有段落
    all_segments = []
    sentences = []
    sentence_id = 1
    
    for segment in segments:
        # 打印预览
        print(f"[{segment.start:.2f}s → {segment.end:.2f}s] {segment.text}")
        
        # 单词详情
        words_list = []
        if segment.words:
            print("  单词时间戳:")
            for word in segment.words:
                print(f"    • {word.word:15s} [{word.start:.2f}s - {word.end:.2f}s]")
                words_list.append({
                    "begin_time": int(word.start * 1000),
                    "end_time": int(word.end * 1000),
                    "text": word.word.strip(),
                    "punctuation": ""
                })
        
        print()
        
        # 构建句子对象（阿里云格式）
        sentences.append({
            "begin_time": int(segment.start * 1000),
            "end_time": int(segment.end * 1000),
            "text": segment.text.strip(),
            "sentence_id": sentence_id,
            "words": words_list
        })
        sentence_id += 1
        all_segments.append(segment)
    
    # 构造阿里云兼容格式
    result = {
        "transcripts": [{
            "channel_id": 0,
            "text": " ".join([s["text"] for s in sentences]),
            "sentences": sentences
        }]
    }
    
    # 保存结果
    output_file = audio_file + ".whisper.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print("="*60)
    print(f"📄 完整 JSON 已保存到: {output_file}")
    print("="*60)
    
    # 对比建议
    print("\n💡 下一步建议:")
    print("1. 将生成的 JSON 与阿里云转写结果对比")
    print("2. 导入到应用中，测试盲听页面的光标对齐")
    print("3. 评估时间戳准确性是否优于阿里云")
    
    return result

if __name__ == "__main__":
    main()
