#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Whisper ASR 脚本 - 替代阿里云转写，保留阿里云翻译

用法:
  python3 whisper_asr.py <audio_url> [language] [--retranslate]
  
示例:
  python3 whisper_asr.py https://example.com/audio.mp3 en
  python3 whisper_asr.py /path/to/audio.mp3 zh
"""
import os
import sys
import json
import urllib.request
import tempfile

def log(msg):
    """安全的日志输出"""
    try:
        with open('/tmp/whisper_asr.log', 'a') as f:
            f.write(msg + '\n')
            f.flush()
    except:
        pass

def download_audio(url, temp_dir):
    """下载音频文件到临时目录"""
    if url.startswith('http://') or url.startswith('https://'):
        log(f"📥 下载音频: {url}")
        temp_file = os.path.join(temp_dir, 'audio.mp3')
        urllib.request.urlretrieve(url, temp_file)
        return temp_file
    else:
        # 本地文件
        return url

def transcribe_with_whisper(audio_file, language='en', model_size='small'):
    """
    使用 Whisper 转写音频
    
    Args:
        audio_file: 音频文件路径
        language: 语言代码 ('en', 'zh', 等)
        model_size: 模型大小 ('tiny', 'base', 'small', 'medium', 'large')
    
    Returns:
        阿里云兼容的 JSON 格式
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        # 降级到 OpenAI Whisper
        try:
            import whisper
            log("⚠️ faster-whisper 未安装，使用 openai-whisper（较慢）")
            return transcribe_with_openai_whisper(audio_file, language, model_size)
        except ImportError:
            raise ImportError("请安装 faster-whisper 或 openai-whisper: pip install faster-whisper")
    
    log(f"🎙️ 开始 Whisper 转写 (模型: {model_size}, 语言: {language})")
    
    # 加载模型
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    
    # 转写（带单词级时间戳）
    segments, info = model.transcribe(
        audio_file,
        language=language if language != 'zh' else 'zh',  # Whisper 使用 'zh' for Chinese
        word_timestamps=True,
        vad_filter=True,  # 语音活动检测，提高准确度
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    log(f"✅ 转写完成 (语言: {info.language}, 概率: {info.language_probability:.2%})")
    
    # 转换为阿里云格式
    sentences = []
    sentence_id = 1
    full_text_parts = []
    
    for segment in segments:
        words_list = []
        
        # 处理单词级时间戳
        if segment.words:
            for word in segment.words:
                words_list.append({
                    "begin_time": int(word.start * 1000),  # 秒 → 毫秒
                    "end_time": int(word.end * 1000),
                    "text": word.word.strip(),
                    "punctuation": ""
                })
        else:
            # 如果没有单词级时间戳，创建一个简单的映射
            words = segment.text.strip().split()
            duration = segment.end - segment.start
            word_duration = duration / max(len(words), 1)
            for i, word in enumerate(words):
                word_start = segment.start + i * word_duration
                word_end = segment.start + (i + 1) * word_duration
                words_list.append({
                    "begin_time": int(word_start * 1000),
                    "end_time": int(word_end * 1000),
                    "text": word,
                    "punctuation": ""
                })
        
        sentence_text = segment.text.strip()
        full_text_parts.append(sentence_text)
        
        sentences.append({
            "begin_time": int(segment.start * 1000),
            "end_time": int(segment.end * 1000),
            "text": sentence_text,
            "sentence_id": sentence_id,
            "words": words_list
        })
        sentence_id += 1
    
    # 构造阿里云兼容格式
    result = {
        "transcripts": [{
            "channel_id": 0,
            "content_duration_in_milliseconds": int(info.duration * 1000) if hasattr(info, 'duration') else 0,
            "text": " ".join(full_text_parts),
            "sentences": sentences
        }]
    }
    
    log(f"📊 生成了 {len(sentences)} 个句子")
    return result

def transcribe_with_openai_whisper(audio_file, language='en', model_size='small'):
    """使用 OpenAI Whisper（降级方案）"""
    import whisper
    
    log(f"🎙️ 使用 OpenAI Whisper (模型: {model_size})")
    model = whisper.load_model(model_size)
    
    # 转写
    result = model.transcribe(
        audio_file,
        language=language,
        word_timestamps=True
    )
    
    # 转换格式（类似上面的逻辑）
    sentences = []
    sentence_id = 1
    
    for segment in result['segments']:
        words_list = []
        if 'words' in segment:
            for word in segment['words']:
                words_list.append({
                    "begin_time": int(word['start'] * 1000),
                    "end_time": int(word['end'] * 1000),
                    "text": word['word'].strip(),
                    "punctuation": ""
                })
        
        sentences.append({
            "begin_time": int(segment['start'] * 1000),
            "end_time": int(segment['end'] * 1000),
            "text": segment['text'].strip(),
            "sentence_id": sentence_id,
            "words": words_list
        })
        sentence_id += 1
    
    return {
        "transcripts": [{
            "channel_id": 0,
            "text": result['text'],
            "sentences": sentences
        }]
    }

def main():
    try:
        # 加载 API Key（用于翻译）
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("ALIYUN_API_KEY")
        if not api_key:
            try:
                script_dir = os.path.dirname(os.path.abspath(__file__))
                with open(os.path.join(script_dir, "api_key.txt"), "r") as f:
                    api_key = f.read().strip()
            except:
                pass
        
        # 获取参数
        if len(sys.argv) < 2:
            print(json.dumps({"error": "Usage: python3 whisper_asr.py <audio_url> [language] [model_size]"}))
            return
        
        audio_url = sys.argv[1]
        language = sys.argv[2] if len(sys.argv) >= 3 else 'en'
        model_size = sys.argv[3] if len(sys.argv) >= 4 else 'small'
        
        log(f"🚀 启动 Whisper ASR")
        log(f"   音频: {audio_url}")
        log(f"   语言: {language}")
        log(f"   模型: {model_size}")
        
        # 创建临时目录
        with tempfile.TemporaryDirectory() as temp_dir:
            # 下载音频
            audio_file = download_audio(audio_url, temp_dir)
            
            # Whisper 转写
            transcription_json = transcribe_with_whisper(audio_file, language, model_size)
            
            # 调用阿里云翻译（复用现有逻辑）
            if api_key:
                log("🔄 调用阿里云翻译...")
                try:
                    # 导入翻译函数
                    script_dir = os.path.dirname(os.path.abspath(__file__))
                    sys.path.insert(0, script_dir)
                    from aliyun_asr import translate_sentences
                    
                    transcription_json = translate_sentences(transcription_json, api_key, language)
                    log("✅ 翻译完成")
                except Exception as e:
                    log(f"⚠️ 翻译失败: {e}")
            else:
                log("⚠️ 未找到 API Key，跳过翻译")
            
            # 输出结果
            print(json.dumps(transcription_json))
            log("✅ 完成")
    
    except Exception as e:
        log(f"❌ 错误: {str(e)}")
        import traceback
        log(traceback.format_exc())
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
