#!/usr/bin/env python3
"""
为已转写的材料补充翻译

用法: python3 add_translation.py <record_id>
示例: python3 add_translation.py 47j7723c9w7a5bd
"""

import sys
import requests

POCKETBASE_URL = "https://zjcnex.top"
ADMIN_EMAIL = "993789049@qq.com"
ADMIN_PASSWORD = "Zhouji107178"

def add_translation(record_id):
    # 1. 登录
    session = requests.Session()
    login_data = {
        "identity": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }
    
    resp = session.post(f"{POCKETBASE_URL}/api/admins/auth-with-password", json=login_data)
    resp.raise_for_status()
    
    token = resp.json()['token']
    session.headers.update({'Authorization': token})
    
    print(f"✅ 登录成功")
    
    # 2. 将状态改为 pending
    update_data = {
        "status": "pending"
    }
    
    resp = session.patch(
        f"{POCKETBASE_URL}/api/collections/transcripts/records/{record_id}",
        json=update_data
    )
    resp.raise_for_status()
    
    print(f"✅ 已将记录 {record_id} 状态改为 pending")
    print(f"💡 Worker 会在 10 秒内自动检测并重新处理（这次会包含翻译）")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 add_translation.py <record_id>")
        print("示例: python3 add_translation.py 47j7723c9w7a5bd")
        sys.exit(1)
    
    record_id = sys.argv[1]
    add_translation(record_id)
