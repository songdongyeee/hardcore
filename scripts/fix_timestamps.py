#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
时间戳智能对齐脚本

功能：使用 Whisper 重建句子时间戳 + 调用阿里云重新翻译
- 句子和单词时间戳来自 Whisper（更精确）
- 翻译重新生成并对齐新句子结构
- 支持自动回写 PocketBase，避免手工复制粘贴

用法：
    python3 fix_timestamps.py <材料ID> [--no-upload]
    python3 fix_timestamps.py <材料ID> --translation-only [--retranslate-all]
    
示例：
    python3 fix_timestamps.py 47j7723c9w7a5bd
"""

import os
import sys
import json
import requests
import argparse
import time
from difflib import SequenceMatcher
from datetime import datetime

# ============ 配置 ============
POCKETBASE_URL = os.getenv("PB_URL", "https://zjcnex.top")
ADMIN_EMAIL = os.getenv("PB_ADMIN_EMAIL", "993789049@qq.com")
ADMIN_PASSWORD = os.getenv("PB_ADMIN_PASSWORD", "Zhouji107178")
# ============================

class TimestampFixer:
    def __init__(self, pb_url=None, admin_email=None, admin_password=None):
        self.pb_url = pb_url or POCKETBASE_URL
        self.admin_email = admin_email or ADMIN_EMAIL
        self.admin_password = admin_password or ADMIN_PASSWORD
        self.session = requests.Session()
        self.auth_token = None
        
    def log(self, msg, level="INFO"):
        """带时间戳和emoji的日志"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        emoji = {
            "INFO": "ℹ️",
            "SUCCESS": "✅",
            "WARNING": "⚠️",
            "ERROR": "❌",
            "PROCESS": "🔄"
        }.get(level, "📝")
        print(f"[{timestamp}] {emoji} {msg}")
        sys.stdout.flush()
    
    def login(self):
        """管理员登录"""
        try:
            self.log("登录 PocketBase...", "PROCESS")
            resp = self.session.post(
                f"{self.pb_url}/api/admins/auth-with-password",
                json={
                    "identity": self.admin_email,
                    "password": self.admin_password
                }
            )
            resp.raise_for_status()
            self.auth_token = resp.json()['token']
            self.session.headers.update({'Authorization': self.auth_token})
            self.log("登录成功", "SUCCESS")
            return True
        except Exception as e:
            self.log(f"登录失败: {e}", "ERROR")
            return False

    def fetch_record_and_json(self, record_id):
        """仅获取记录与 text JSON（不下载音频）"""
        try:
            resp = self.session.get(
                f"{self.pb_url}/api/collections/transcripts/records/{record_id}"
            )
            resp.raise_for_status()
            record = resp.json()

            raw_text = record.get('text', '[]')
            if isinstance(raw_text, str):
                aliyun_json = json.loads(raw_text)
            else:
                aliyun_json = raw_text

            if not aliyun_json:
                raise ValueError("材料没有转写文本")

            return record, aliyun_json
        except Exception as e:
            self.log(f"获取材料JSON失败: {e}", "ERROR")
            return None, None
    
    def download_material(self, record_id):
        """下载材料的音频和阿里云 JSON"""
        try:
            self.log(f"下载材料: {record_id}", "PROCESS")

            record, aliyun_json = self.fetch_record_and_json(record_id)
            if not record:
                return None, None, None
            
            # 下载音频
            audio_filename = record['audio']
            collection_id = record['collectionId']
            audio_url = f"{self.pb_url}/api/files/{collection_id}/{record_id}/{audio_filename}"
            
            audio_path = f"/tmp/fix_audio_{record_id}.tmp"
            resp = self.session.get(audio_url)
            resp.raise_for_status()
            with open(audio_path, 'wb') as f:
                f.write(resp.content)
            
            self.log(f"音频已下载: {audio_filename}", "SUCCESS")

            sentence_count = 0
            try:
                sentence_count = len(aliyun_json[0]['sentences'])
            except Exception:
                pass
            self.log(f"阿里云 JSON 已加载: {sentence_count} 个句子", "SUCCESS")
            
            return audio_path, aliyun_json, record
            
        except Exception as e:
            self.log(f"下载失败: {e}", "ERROR")
            return None, None, None
    
    def transcribe_with_whisper(self, audio_path):
        """使用 Whisper 转写获取时间戳"""
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            self.log("faster-whisper 未安装，请运行: pip3 install faster-whisper", "ERROR")
            return None
        
        try:
            self.log("Whisper 转写中...", "PROCESS")
            
            model = WhisperModel("small", device="cpu", compute_type="int8")
            segments, info = model.transcribe(
                audio_path,
                language="en",
                word_timestamps=True,
                vad_filter=True
            )
            
            # 提取句子和单词
            whisper_sentences = []
            for segment in segments:
                words_list = []
                if segment.words:
                    for word in segment.words:
                        words_list.append({
                            "text": word.word.strip(),
                            "begin_time": int(word.start * 1000),
                            "end_time": int(word.end * 1000)
                        })
                
                whisper_sentences.append({
                    "text": segment.text.strip(),
                    "begin_time": int(segment.start * 1000),
                    "end_time": int(segment.end * 1000),
                    "words": words_list
                })
            
            self.log(f"Whisper 转写完成: {len(whisper_sentences)} 个句子", "SUCCESS")
            return whisper_sentences
            
        except Exception as e:
            self.log(f"Whisper 转写失败: {e}", "ERROR")
            return None
    
    def translate_whisper_sentences(self, whisper_sentences, only_missing=False):
        """
        调用阿里云 DashScope API 为每个 Whisper 句子生成翻译
        
        使用 Qwen-Flash 模型批量翻译，使用ID锚点防止错位
        """
        try:
            from dashscope import Generation
            import re
        except ImportError:
            self.log("❌ dashscope 模块未安装，跳过翻译", "WARNING")
            self.log("提示: pip install dashscope", "INFO")
            return whisper_sentences
        
        # 从环境变量获取API密钥
        api_key = os.getenv('DASHSCOPE_API_KEY')
        if not api_key:
            self.log("❌ 未找到 DASHSCOPE_API_KEY 环境变量", "WARNING")
            self.log("提示: export DASHSCOPE_API_KEY=你的密钥", "INFO")
            return whisper_sentences
        
        self.log(f"🔄 开始翻译 {len(whisper_sentences)} 个句子...", "PROCESS")

        # 重试与质量阈值配置
        batch_size = int(os.getenv("DASHSCOPE_BATCH_SIZE", "15"))
        max_retries = int(os.getenv("DASHSCOPE_MAX_RETRIES", "4"))  # 每批最大重试次数
        single_retries = int(os.getenv("DASHSCOPE_SINGLE_RETRIES", "3"))  # 逐句补翻重试
        retry_backoff = float(os.getenv("DASHSCOPE_RETRY_BACKOFF", "1.5"))  # 指数退避基数（秒）
        strict_coverage = os.getenv("STRICT_TRANSLATION_COVERAGE", "1") == "1"
        min_coverage = float(os.getenv("MIN_TRANSLATION_COVERAGE", "0.98"))

        def build_prompt(lines):
            return f"""请将以下句子逐句翻译成中文。严格保持每行的ID前缀不变（如[0]）。
1. 绝对不要合并行！绝对不要改变ID！
2. 如果一行不完整，就翻译成不完整的。
3. 输出行数必须与输入行数完全一致。
不要输出任何额外解释：
{chr(10).join(lines)}"""

        # 批量处理
        total = len(whisper_sentences)
        initial_missing = sum(1 for s in whisper_sentences if not s.get('translation'))
        target_total = initial_missing if only_missing else total

        if only_missing and target_total == 0:
            self.log("✅ 当前所有句子已有翻译，跳过补翻", "SUCCESS")
            return whisper_sentences
        
        for i in range(0, total, batch_size):
            batch = whisper_sentences[i:i + batch_size]

            # 全量重翻时先清空；补翻模式保留已有翻译
            if not only_missing:
                for sent in batch:
                    sent.pop('translation', None)

            pending_indices = [
                idx for idx in range(len(batch))
                if (not batch[idx].get('translation'))
            ] if only_missing else list(range(len(batch)))
            batch_no = i // batch_size + 1
            total_batches = (total + batch_size - 1) // batch_size

            # 第一层：批次重试（指数退避）
            for attempt in range(1, max_retries + 1):
                if not pending_indices:
                    break

                lines = []
                local_to_batch = {}
                for local_idx, batch_idx in enumerate(pending_indices):
                    clean_text = batch[batch_idx].get('text', '').replace('\n', ' ').strip()
                    lines.append(f"[{local_idx}] {clean_text}")
                    local_to_batch[local_idx] = batch_idx

                prompt = build_prompt(lines)

                try:
                    response = Generation.call(
                        model='qwen-flash',
                        prompt=prompt,
                        api_key=api_key
                    )

                    if response.status_code == 200:
                        result_text = response.output.text.strip()
                        pattern = re.compile(r'^\[(\d+)\]\s*(.*)', re.MULTILINE)

                        newly_matched = 0
                        for match in pattern.finditer(result_text):
                            try:
                                local_idx = int(match.group(1))
                                trans_text = match.group(2).strip()
                                if local_idx in local_to_batch and trans_text:
                                    b_idx = local_to_batch[local_idx]
                                    if not batch[b_idx].get('translation'):
                                        newly_matched += 1
                                    batch[b_idx]['translation'] = trans_text
                            except Exception:
                                continue

                        pending_indices = [idx for idx in pending_indices if not batch[idx].get('translation')]
                        matched_now = len(batch) - len(pending_indices)
                        self.log(
                            f"✅ 批次 {batch_no}/{total_batches} 第{attempt}次: "
                            f"累计 {matched_now}/{len(batch)}（本次新增 {newly_matched}）",
                            "SUCCESS"
                        )
                    else:
                        self.log(
                            f"❌ 批次 {batch_no}/{total_batches} 第{attempt}次 API错误: "
                            f"{response.code} - {response.message}",
                            "ERROR"
                        )

                except Exception as e:
                    self.log(
                        f"❌ 批次 {batch_no}/{total_batches} 第{attempt}次失败: {str(e)}",
                        "ERROR"
                    )

                if pending_indices and attempt < max_retries:
                    sleep_s = retry_backoff * (2 ** (attempt - 1))
                    self.log(
                        f"⏳ 批次 {batch_no}/{total_batches} 仍有 {len(pending_indices)} 句未翻译，"
                        f"{sleep_s:.1f}s 后重试",
                        "WARNING"
                    )
                    time.sleep(sleep_s)

            # 第二层：逐句补翻（只处理批次重试后仍失败的句子）
            if pending_indices:
                self.log(
                    f"⚠️ 批次 {batch_no}/{total_batches} 进入逐句补翻，剩余 {len(pending_indices)} 句",
                    "WARNING"
                )
                for batch_idx in list(pending_indices):
                    sent_text = batch[batch_idx].get('text', '').replace('\n', ' ').strip()
                    if not sent_text:
                        continue

                    success = False
                    single_prompt = build_prompt([f"[0] {sent_text}"])
                    for attempt in range(1, single_retries + 1):
                        try:
                            response = Generation.call(
                                model='qwen-flash',
                                prompt=single_prompt,
                                api_key=api_key
                            )
                            if response.status_code == 200:
                                result_text = response.output.text.strip()
                                pattern = re.compile(r'^\[(\d+)\]\s*(.*)', re.MULTILINE)
                                for match in pattern.finditer(result_text):
                                    local_idx = int(match.group(1))
                                    trans_text = match.group(2).strip()
                                    if local_idx == 0 and trans_text:
                                        batch[batch_idx]['translation'] = trans_text
                                        success = True
                                        break
                            if success:
                                break
                        except Exception as e:
                            self.log(f"❌ 逐句补翻失败（第{attempt}次）: {str(e)}", "ERROR")

                        if attempt < single_retries:
                            sleep_s = retry_backoff * (2 ** (attempt - 1))
                            time.sleep(sleep_s)

                    if not success:
                        self.log(f"❌ 逐句补翻最终失败: {sent_text[:50]}...", "ERROR")
        
        # 统计
        with_translation = sum(1 for s in whisper_sentences if s.get('translation'))
        if only_missing:
            remaining_missing = sum(1 for s in whisper_sentences if not s.get('translation'))
            fixed_count = initial_missing - remaining_missing
            coverage = (fixed_count / target_total) if target_total > 0 else 1.0
            self.log(
                f"✅ 补翻完成: 修复 {fixed_count}/{target_total} 个缺失翻译（覆盖率 {coverage:.1%}）",
                "SUCCESS"
            )
        else:
            coverage = (with_translation / total) if total > 0 else 0
            self.log(
                f"✅ 翻译完成: {with_translation}/{total} 个句子有翻译（覆盖率 {coverage:.1%}）",
                "SUCCESS"
            )

        if strict_coverage and coverage < min_coverage:
            raise RuntimeError(
                f"翻译覆盖率不足：{coverage:.1%} < 目标 {min_coverage:.1%}，已阻止回写。"
            )
        
        return whisper_sentences
    
    def match_translation_by_similarity(self, aliyun_sentences, whisper_sentences):
        """
        基于文本相似度匹配：把阿里云翻译分配给最相似的Whisper句子
        
        策略：
        1. 对每个阿里云句子（有翻译）
        2. 计算它和所有 Whisper 句子的文本相似度
        3. 找到最相似的 Whisper 句子，把翻译放那里
        
        优点：即使阿里云句子和翻译错位，也能通过文本内容匹配到正确位置
        """
        self.log("开始匹配翻译（基于文本相似度）...", "PROCESS")
        
        matched_count = 0
        
        for ali_sent in aliyun_sentences:
            if not ali_sent.get('translation'):
                continue
            
            ali_text = ali_sent['text'].lower().strip()
            ali_translation = ali_sent['translation']
            
            # 找到文本最相似的 Whisper 句子
            best_match = None
            best_ratio = 0
            
            for w_sent in whisper_sentences:
                w_text = w_sent['text'].lower().strip()
                
                # 计算文本相似度
                ratio = SequenceMatcher(None, ali_text, w_text).ratio()
                
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_match = w_sent
            
            # 如果相似度 > 50%，认为匹配成功
            if best_match and best_ratio > 0.5:
                # 如果这个Whisper句子已经有翻译，合并翻译
                if best_match.get('translation'):
                    best_match['translation'] += ' ' + ali_translation
                else:
                    best_match['translation'] = ali_translation
                matched_count += 1
        
        self.log(f"翻译匹配完成: {matched_count}/{len(aliyun_sentences)} 个阿里云句子的翻译已分配", "SUCCESS")
        
        return whisper_sentences
    
    def align_sentences(self, aliyun_json, whisper_sentences):
        """
        新算法：直接使用 Whisper 的句子结构，调用API生成翻译
        
        策略：
        1. 完全使用 Whisper 的 98 个句子（含时间戳和单词）
        2. 调用阿里云翻译API为每个Whisper句子生成翻译
        3. 不再使用阿里云原有翻译（已错位）
        
        优点：
        - 时间戳 100% 来自 Whisper（精确）
        - 覆盖全部音频（不会缺失）
        - 翻译和句子准确对应（新生成）
        """
        self.log("开始构建新的句子结构（基于 Whisper + 新翻译）...", "PROCESS")
        
        # 1. 调用翻译API为所有Whisper句子生成翻译
        whisper_with_translation = self.translate_whisper_sentences(whisper_sentences, only_missing=False)
        
        # 2. 统计
        total_whisper = len(whisper_with_translation)
        with_translation = sum(1 for s in whisper_with_translation if s.get('translation'))
        
        self.log(f"✅ Whisper 句子数: {total_whisper}", "SUCCESS")
        self.log(f"✅ 有翻译的句子: {with_translation}", "SUCCESS")
        self.log(f"✅ 无翻译的句子: {total_whisper - with_translation}", "INFO")
        self.log(f"✅ 所有时间戳均来自 Whisper（精确）", "SUCCESS")
        self.log(f"✅ 所有翻译均为新生成（准确对应）", "SUCCESS")
        
        # 3. 替换阿里云数据结构
        aliyun_json[0]['sentences'] = whisper_with_translation
        
        return aliyun_json

    def patch_translation_only(self, aliyun_json, only_missing=True):
        """
        只补翻译，不重跑 Whisper，不改时间戳与分句结构。
        """
        self.log("开始只补翻译模式（不重跑Whisper）...", "PROCESS")
        if not isinstance(aliyun_json, list) or not aliyun_json:
            raise RuntimeError("JSON结构异常：根节点不是非空数组")
        if not isinstance(aliyun_json[0], dict) or 'sentences' not in aliyun_json[0]:
            raise RuntimeError("JSON结构异常：缺少 sentences")

        sentences = aliyun_json[0].get('sentences') or []
        if not sentences:
            raise RuntimeError("无可补翻译句子：sentences 为空")

        self.translate_whisper_sentences(sentences, only_missing=only_missing)
        aliyun_json[0]['sentences'] = sentences
        return aliyun_json
    
    def save_output(self, record_id, aligned_json):
        """保存输出文件"""
        output_file = f"/tmp/material_{record_id}_fixed.json"
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(aligned_json, f, ensure_ascii=False, indent=2)
        
        self.log(f"已保存到: {output_file}", "SUCCESS")
        return output_file

    def save_backup(self, record_id, original_json):
        """保存原始 JSON 备份（防止误覆盖）"""
        backup_file = f"/tmp/material_{record_id}_backup.json"
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump(original_json, f, ensure_ascii=False, indent=2)
        self.log(f"原始备份已保存: {backup_file}", "SUCCESS")
        return backup_file

    def upload_to_pb(self, record_id, aligned_json):
        """自动回写修复后的 JSON 到 PocketBase"""
        try:
            self.log("自动回写到 PocketBase...", "PROCESS")
            payload = {
                "text": json.dumps(aligned_json, ensure_ascii=False),
                "status": "done"
            }
            resp = self.session.patch(
                f"{self.pb_url}/api/collections/transcripts/records/{record_id}",
                json=payload
            )
            resp.raise_for_status()
            self.log("✅ 已自动回写到 PB（text + status=done）", "SUCCESS")
            return True
        except Exception as e:
            self.log(f"自动回写失败: {e}", "ERROR")
            return False
    
    def run(self, record_id, auto_upload=True, mode="full", only_missing_translation=True):
        """主流程"""
        self.log(f"=== 开始处理材料: {record_id} | mode={mode} ===", "INFO")
        
        # 1. 登录
        if not self.login():
            return False
        
        audio_path = None
        if mode == "full":
            # 2. 下载材料（含音频）
            audio_path, aliyun_json, record = self.download_material(record_id)
            if not audio_path:
                return False
        elif mode == "translation_only":
            # 2. 仅获取 JSON（不下载音频）
            record, aliyun_json = self.fetch_record_and_json(record_id)
            if not record:
                return False
            self.log("已获取原始 JSON，跳过音频下载与Whisper", "INFO")
        else:
            raise RuntimeError(f"未知模式: {mode}")

        # 2.1 保存原始备份
        self.save_backup(record_id, aliyun_json)

        if mode == "full":
            # 3. Whisper 转写
            whisper_sentences = self.transcribe_with_whisper(audio_path)
            if not whisper_sentences:
                return False

            # 4. 智能对齐
            aligned_json = self.align_sentences(aliyun_json, whisper_sentences)
        else:
            # 3/4. 只补翻译
            aligned_json = self.patch_translation_only(
                aliyun_json,
                only_missing=only_missing_translation
            )
        
        # 5. 保存输出
        output_file = self.save_output(record_id, aligned_json)

        # 6. 自动回写（默认开启）
        if auto_upload:
            ok = self.upload_to_pb(record_id, aligned_json)
            if not ok:
                self.log("⚠️ 自动回写失败，请手动复制 /tmp 输出文件到 PB", "WARNING")
        else:
            self.log("已跳过自动回写（--no-upload）", "INFO")
        
        # 7. 清理临时文件
        if audio_path:
            try:
                os.remove(audio_path)
            except:
                pass
        
        # 8. 完成提示
        self.log("=== 处理完成 ===", "SUCCESS")
        self.log(f"输出文件: {output_file}", "INFO")
        if auto_upload:
            self.log("已完成自动回写，无需手动复制粘贴。", "SUCCESS")
        else:
            self.log("", "INFO")
            self.log("下一步操作:", "INFO")
            self.log("1. 打开 PocketBase 后台", "INFO")
            self.log(f"2. 找到材料 {record_id}", "INFO")
            self.log("3. 复制 JSON 内容到 'text' 字段", "INFO")
            self.log("4. 保存", "INFO")
        
        return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="修复时间戳并可自动回写 PocketBase")
    parser.add_argument("record_id", help="transcripts 记录 ID")
    parser.add_argument(
        "--translation-only",
        action="store_true",
        help="只补翻译，不重跑Whisper与时间戳"
    )
    parser.add_argument(
        "--retranslate-all",
        action="store_true",
        help="在 --translation-only 模式下，重翻全部句子（默认仅补缺失翻译）"
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="仅生成本地文件，不自动回写 PB"
    )
    args = parser.parse_args()

    record_id = args.record_id
    fixer = TimestampFixer()
    mode = "translation_only" if args.translation_only else "full"
    only_missing_translation = not args.retranslate_all
    success = fixer.run(
        record_id,
        auto_upload=not args.no_upload,
        mode=mode,
        only_missing_translation=only_missing_translation,
    )
    
    sys.exit(0 if success else 1)
