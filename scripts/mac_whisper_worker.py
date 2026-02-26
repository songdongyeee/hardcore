#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mac Whisper 转写工作进程

在你的 Mac 上运行，自动处理服务器上标记为 whisper 的转写任务

用法:
  python3 mac_whisper_worker.py

配置:
  在脚本中填写你的 PocketBase URL 和 Admin 凭据
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse
import ssl
from datetime import datetime

# ============ 配置区域 ============
POCKETBASE_URL = "https://zjcnex.top"  # ✅ 你的 PocketBase 地址
ADMIN_EMAIL = "993789049@qq.com"       # 📧 PB Admin 邮箱
ADMIN_PASSWORD = "Zhouji107178"        # 🔑 PB Admin 密码
CHECK_INTERVAL = 10  # 检查间隔（秒）- 每 10 秒检查一次新任务
# ==================================

class WhisperWorker:
    def __init__(self):
        self.pb_url = POCKETBASE_URL
        self.admin_email = ADMIN_EMAIL
        self.admin_password = ADMIN_PASSWORD
        self.auth_token = None
        # 创建 SSL 上下文，解决连接问题
        self.ssl_context = ssl.create_default_context()
        self.ssl_context.check_hostname = True
        self.ssl_context.verify_mode = ssl.CERT_REQUIRED
        
    def log(self, msg):
        """带时间戳的日志"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {msg}")
    
    def login_admin(self):
        """管理员登录获取 token"""
        try:
            url = f"{self.pb_url}/api/admins/auth-with-password"
            data = json.dumps({
                "identity": self.admin_email,
                "password": self.admin_password
            }).encode('utf-8')
            
            req = urllib.request.Request(
                url,
                data=data,
                headers={'Content-Type': 'application/json'}
            )
            
            with urllib.request.urlopen(req, context=self.ssl_context, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8'))
                self.auth_token = result['token']
                self.log("✅ 管理员登录成功")
                return True
        except Exception as e:
            self.log(f"❌ 登录失败: {e}")
            return False
    
    def fetch_pending_tasks(self):
        """获取待处理的转写任务"""
        try:
            # 查询条件: asr_engine='whisper' AND status='pending'
            filter_query = urllib.parse.quote("asr_engine='whisper' && status='pending'")
            url = f"{self.pb_url}/api/collections/transcripts/records?filter={filter_query}"
            
            req = urllib.request.Request(
                url,
                headers={'Authorization': self.auth_token}
            )
            
            with urllib.request.urlopen(req, context=self.ssl_context, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8'))
                return result.get('items', [])
        except Exception as e:
            self.log(f"⚠️ 获取任务失败: {e}")
            return []
    
    def download_audio(self, record):
        """下载音频文件"""
        try:
            audio_filename = record['audio']
            collection_id = record['collectionId']
            record_id = record['id']
            
            audio_url = f"{self.pb_url}/api/files/{collection_id}/{record_id}/{audio_filename}"
            
            # 下载到临时文件
            temp_file = f"/tmp/whisper_audio_{record_id}.tmp"
            urllib.request.urlretrieve(audio_url, temp_file)
            
            self.log(f"📥 音频已下载: {audio_filename}")
            return temp_file
        except Exception as e:
            self.log(f"❌ 下载失败: {e}")
            return None
    
    def transcribe_with_whisper(self, audio_file, language='en'):
        """使用 Whisper 转写"""
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            self.log("❌ faster-whisper 未安装")
            return None
        
        try:
            self.log("🎙️ 开始 Whisper 转写...")
            
            # 加载模型（small 模型在 Mac 上速度合理）
            model = WhisperModel("small", device="cpu", compute_type="int8")
            
            # 转写
            segments, info = model.transcribe(
                audio_file,
                language=language,
                word_timestamps=True,
                vad_filter=True
            )
            
            # 转换为阿里云格式
            sentences = []
            sentence_id = 1
            full_text_parts = []
            
            for segment in segments:
                words_list = []
                
                if segment.words:
                    for word in segment.words:
                        words_list.append({
                            "begin_time": int(word.start * 1000),
                            "end_time": int(word.end * 1000),
                            "text": word.word.strip(),
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
            
            result = [{
                "channel_id": 0,
                "text": " ".join(full_text_parts),
                "sentences": sentences
            }]
            
            self.log(f"✅ 转写完成！生成 {len(sentences)} 个句子")
            return result
            
        except Exception as e:
            self.log(f"❌ 转写失败: {e}")
            return None
    
    def translate_with_aliyun(self, transcription_data, language='en'):
        """调用阿里云翻译"""
        try:
            # 读取 API Key
            api_key = os.getenv("DASHSCOPE_API_KEY")
            if not api_key:
                try:
                    with open("pb_hooks/api_key.txt", "r") as f:
                        api_key = f.read().strip()
                except:
                    pass
            
            if not api_key:
                self.log("⚠️ 未找到阿里云 API Key，跳过翻译")
                return transcription_data
            
            from dashscope import Generation
            import re
            
            self.log("🔄 调用阿里云翻译...")
            
            sentences_list = transcription_data[0]['sentences']
            
            # 批量翻译
            batch_size = 15
            for i in range(0, len(sentences_list), batch_size):
                batch = sentences_list[i:i + batch_size]
                
                prompt_lines = []
                for j, sent in enumerate(batch):
                    clean_text = sent.get('text', '').replace('\n', ' ').strip()
                    prompt_lines.append(f"[{j}] {clean_text}")
                
                if language == 'zh':
                    prompt = f"Translate to English. Keep ID prefix. No merging:\n" + "\n".join(prompt_lines)
                else:
                    prompt = f"请翻译成中文。保持ID前缀不变，不要合并:\n" + "\n".join(prompt_lines)
                
                response = Generation.call(
                    model='qwen-flash',
                    prompt=prompt,
                    api_key=api_key
                )
                
                if response.status_code == 200:
                    result_text = response.output.text.strip()
                    pattern = re.compile(r'^\[(\d+)\]\s*(.*)', re.MULTILINE)
                    
                    for match in pattern.finditer(result_text):
                        local_idx = int(match.group(1))
                        trans_text = match.group(2).strip()
                        
                        if 0 <= local_idx < len(batch):
                            batch[local_idx]['translation'] = trans_text
            
            self.log("✅ 翻译完成")
            return transcription_data
            
        except Exception as e:
            self.log(f"⚠️ 翻译失败: {e}")
            return transcription_data
    
    def update_record(self, record_id, transcription_data, status='done'):
        """更新转写结果到 PocketBase"""
        try:
            url = f"{self.pb_url}/api/collections/transcripts/records/{record_id}"
            
            data = json.dumps({
                "text": json.dumps(transcription_data),
                "status": status
            }).encode('utf-8')
            
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': self.auth_token
                },
                method='PATCH'
            )
            
            with urllib.request.urlopen(req) as response:
                self.log("✅ 结果已上传到服务器")
                return True
        except Exception as e:
            self.log(f"❌ 上传失败: {e}")
            return False
    
    def process_task(self, record):
        """处理单个转写任务"""
        record_id = record['id']
        self.log(f"\n{'='*50}")
        self.log(f"📋 处理任务: {record_id}")
        
        # 标记为处理中
        try:
            url = f"{self.pb_url}/api/collections/transcripts/records/{record_id}"
            data = json.dumps({"status": "processing"}).encode('utf-8')
            req = urllib.request.Request(
                url, data=data,
                headers={'Content-Type': 'application/json', 'Authorization': self.auth_token},
                method='PATCH'
            )
            urllib.request.urlopen(req)
        except:
            pass
        
        # 1. 下载音频
        audio_file = self.download_audio(record)
        if not audio_file:
            self.update_record(record_id, None, status='error')
            return
        
        # 2. 转写
        language = record.get('language', 'en')
        transcription = self.transcribe_with_whisper(audio_file, language)
        
        # 清理临时文件
        try:
            os.remove(audio_file)
        except:
            pass
        
        if not transcription:
            self.update_record(record_id, None, status='error')
            return
        
        # 3. 翻译
        transcription = self.translate_with_aliyun(transcription, language)
        
        # 4. 上传结果
        self.update_record(record_id, transcription, status='done')
        
        self.log(f"🎉 任务完成: {record_id}")
    
    def run(self):
        """主循环"""
        self.log("🚀 Mac Whisper Worker 启动")
        self.log(f"📍 PocketBase: {self.pb_url}")
        self.log(f"⏰ 检查间隔: {CHECK_INTERVAL}秒")
        
        # 登录
        if not self.login_admin():
            self.log("❌ 无法启动，请检查管理员凭据")
            return
        
        self.log("👀 开始监听转写任务...")
        self.log("💡 提示: 在 PB 后台上传时，设置 asr_engine = 'whisper'\n")
        
        while True:
            try:
                # 获取待处理任务
                tasks = self.fetch_pending_tasks()
                
                if tasks:
                    self.log(f"📬 发现 {len(tasks)} 个待处理任务")
                    
                    for task in tasks:
                        self.process_task(task)
                else:
                    # 静默等待
                    pass
                
                # 等待下次检查
                time.sleep(CHECK_INTERVAL)
                
            except KeyboardInterrupt:
                self.log("\n👋 收到停止信号，退出...")
                break
            except Exception as e:
                self.log(f"⚠️ 循环错误: {e}")
                time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    # 检查配置
    if ADMIN_EMAIL == "your_admin@example.com":
        print("❌ 请先在脚本中配置你的 PocketBase 管理员凭据")
        print("\n编辑 mac_whisper_worker.py:")
        print("  - POCKETBASE_URL")
        print("  - ADMIN_EMAIL")
        print("  - ADMIN_PASSWORD")
        sys.exit(1)
    
    worker = WhisperWorker()
    worker.run()
