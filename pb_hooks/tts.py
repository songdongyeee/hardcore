#!/usr/bin/env python3
import sys
import os
import json
import uuid

def main():
    input_file = sys.argv[1] if len(sys.argv) > 1 else None
    if not input_file:
        print(json.dumps({"error": "no input file"}))
        return

    try:
        with open(input_file) as f:
            params = json.load(f)
    except Exception as e:
        print(json.dumps({"error": f"read input failed: {e}"}))
        return

    text = params.get("text", "").strip()
    if not text:
        print(json.dumps({"error": "text is required"}))
        return

    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("ALIYUN_API_KEY")
    if not api_key:
        try:
            api_key = open("/www/pocketbase/pb_hooks/api_key.txt").read().strip()
        except Exception:
            pass

    if not api_key:
        print(json.dumps({"error": "DASHSCOPE_API_KEY not set"}))
        return

    try:
        import dashscope
        from dashscope.audio.tts_v2 import SpeechSynthesizer
        dashscope.api_key = api_key

        synthesizer = SpeechSynthesizer(model="cosyvoice-v3-flash", voice="longanyang")
        audio = synthesizer.call(text)

        if not audio:
            print(json.dumps({"error": "no audio returned from API"}))
            return

        out_dir = "/www/pocketbase/pb_public/tts"
        os.makedirs(out_dir, exist_ok=True)

        filename = f"{uuid.uuid4().hex}.mp3"
        out_path = os.path.join(out_dir, filename)
        with open(out_path, "wb") as f:
            f.write(audio)

        print(json.dumps({"audioPath": f"/tts/{filename}"}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
