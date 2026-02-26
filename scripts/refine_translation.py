import json
import os
import sys
import time
from dashscope import Generation
import re

def refine_translations(file_path):
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ 无法读取文件: {e}")
        return

    # Handle list root if necessary
    root = data[0] if isinstance(data, list) else data

    # Try to find 'sentences' list
    sentences = []
    if 'sentences' in root:
        sentences = root['sentences']
    elif 'transcripts' in root:
        # Handle case where it's wrapped in transcripts
        t = root['transcripts']
        if isinstance(t, list) and len(t) > 0:
            sentences = t[0].get('sentences', [])
    
    if not sentences:
        print("❌ JSON 结构错误: 未找到 sentences 列表")
        return

    # 找出无翻译的句子索引
    missing_indices = [i for i, s in enumerate(sentences) if not s.get('translation')]
    total_missing = len(missing_indices)
    
    if total_missing == 0:
        print("✅ 所有句子都有翻译，无需补全")
        return

    print(f"🔍 发现 {total_missing} 个句子缺失翻译，开始补全...")
    
    api_key = os.getenv('DASHSCOPE_API_KEY')
    if not api_key:
        print("❌ 未找到 DASHSCOPE_API_KEY 环境变量")
        return

    # 降低 Batch size 以应对网络不稳定
    batch_size = 5
    fixed_count = 0

    # 按批次处理缺失的索引
    
    for i in range(0, total_missing, batch_size):
        batch_indices = missing_indices[i:i + batch_size]
        batch_sentences = [sentences[idx] for idx in batch_indices]
        
        # 构建 Prompt
        prompt_lines = []
        for j, sent in enumerate(batch_sentences):
            clean_text = sent.get('text', '').replace('\n', ' ').strip()
            # 使用 batch 内的相对索引 j 作为 ID
            prompt_lines.append(f"[{j}] {clean_text}")
        
        prompt = f"""请将以下句子逐句翻译成中文。严格保持每行的ID前缀不变（如[0]）。
1. 绝对不要合并行！绝对不要改变ID！
2. 如果一行不完整，就翻译成不完整的。
3. 输出行数必须与输入行数完全一致。
不要输出任何额外解释：
{chr(10).join(prompt_lines)}"""

        # 重试机制 (增加重试次数)
        success = False
        for attempt in range(5):
            try:
                response = Generation.call(
                    model='qwen-flash',
                    prompt=prompt,
                    api_key=api_key
                )
                
                if response.status_code == 200:
                    result_text = response.output.text.strip()
                    
                    # 解析结果
                    pattern = re.compile(r'^\[(\d+)\]\s*(.*)', re.MULTILINE)
                    
                    matched_in_batch = 0
                    for match in pattern.finditer(result_text):
                        try:
                            local_idx = int(match.group(1))
                            trans_text = match.group(2).strip()
                            
                            if 0 <= local_idx < len(batch_indices):
                                global_idx = batch_indices[local_idx]
                                sentences[global_idx]['translation'] = trans_text
                                matched_in_batch += 1
                        except:
                            continue
                    
                    if matched_in_batch > 0:
                        print(f"✅ 批次 {i//batch_size + 1}:甚至成功补全 {matched_in_batch}/{len(batch_indices)} 个")
                        fixed_count += matched_in_batch
                        success = True
                        break
                    else:
                        print(f"⚠️ 批次 {i//batch_size + 1}: API 返回但不包含有效对应，重试...")
                else:
                    print(f"⚠️ API 错误: {response.code}，重试... ({attempt+1}/3)")
                    time.sleep(2)
            except Exception as e:
                print(f"⚠️ 异常: {e}，重试... ({attempt+1}/3)")
                time.sleep(2)
        
        if not success:
            print(f"❌ 批次 {i//batch_size + 1} 最终失败，跳过")

    # 保存结果
    try:
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"✅ 修复完成！共补全 {fixed_count}/{total_missing} 个句子")
        print(f"📂 文件已更新: {file_path}")
    except Exception as e:
        print(f"❌ 保存文件失败: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 refine_translation.py <json_file_path>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    refine_translations(file_path)
