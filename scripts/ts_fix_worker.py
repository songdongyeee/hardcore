#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地时间戳修复 Worker（手动标记模式）

设计目标：
- 不改阿里云后端脚本
- 只处理你在 PB 后台手动标记为 ts_fix_status='pending' 的记录
- 本地自动修复并回写 PB，避免手工复制粘贴

用法：
  python3 scripts/ts_fix_worker.py

依赖字段（transcripts 集合）：
- ts_fix_status（text 或 select）
  可选值建议：pending / pending_translate / processing / done / error
"""

import os
import sys
import time
import fcntl
import socket
import requests
from datetime import datetime

from fix_timestamps import TimestampFixer, POCKETBASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD

CHECK_INTERVAL = int(os.getenv("TS_FIX_CHECK_INTERVAL", "15"))
BATCH_SIZE = int(os.getenv("TS_FIX_BATCH_SIZE", "5"))
LOCK_FILE = os.getenv("TS_FIX_LOCK_FILE", "/tmp/ts_fix_worker.lock")
WORKER_ID = os.getenv("TS_FIX_WORKER_ID", f"{socket.gethostname()}-{os.getpid()}")
PROCESS_RETRIES = int(os.getenv("TS_FIX_PROCESS_RETRIES", "2"))  # 单任务失败后自动重试次数
RETRY_BACKOFF = float(os.getenv("TS_FIX_PROCESS_RETRY_BACKOFF", "5"))  # 秒


class TsFixWorker:
    def __init__(self):
        self.pb_url = os.getenv("PB_URL", POCKETBASE_URL)
        self.admin_email = os.getenv("PB_ADMIN_EMAIL", ADMIN_EMAIL)
        self.admin_password = os.getenv("PB_ADMIN_PASSWORD", ADMIN_PASSWORD)

        self.session = requests.Session()
        self.auth_token = None
        self._lock_fp = None

    def log(self, msg, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        emoji = {
            "INFO": "ℹ️",
            "SUCCESS": "✅",
            "WARNING": "⚠️",
            "ERROR": "❌",
            "PROCESS": "🔄",
        }.get(level, "📝")
        print(f"[{timestamp}] {emoji} {msg}")
        sys.stdout.flush()

    def acquire_lock(self):
        self._lock_fp = open(LOCK_FILE, "w")
        try:
            fcntl.flock(self._lock_fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._lock_fp.write(str(os.getpid()))
            self._lock_fp.flush()
            return True
        except OSError:
            self.log(f"检测到已有 Worker 在运行（锁文件：{LOCK_FILE}）", "ERROR")
            return False

    def login_admin(self):
        try:
            resp = self.session.post(
                f"{self.pb_url}/api/admins/auth-with-password",
                json={
                    "identity": self.admin_email,
                    "password": self.admin_password,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            self.auth_token = data["token"]
            self.session.headers.update({"Authorization": self.auth_token})
            self.log("管理员登录成功", "SUCCESS")
            return True
        except Exception as e:
            self.log(f"管理员登录失败: {e}", "ERROR")
            return False

    def fetch_pending_tasks(self):
        """获取手动标记任务：pending(全流程) / pending_translate(只补翻译)"""
        try:
            filter_expr = "ts_fix_status='pending' || ts_fix_status='pending_translate'"
            resp = self.session.get(
                f"{self.pb_url}/api/collections/transcripts/records",
                params={
                    "filter": filter_expr,
                    "perPage": BATCH_SIZE,
                    "sort": "+updated",
                    "fields": "id,ts_fix_status,updated",
                },
                timeout=30,
            )

            if resp.status_code == 401:
                self.log("Token 失效，重新登录...", "WARNING")
                if not self.login_admin():
                    return []
                resp = self.session.get(
                    f"{self.pb_url}/api/collections/transcripts/records",
                    params={
                        "filter": filter_expr,
                        "perPage": BATCH_SIZE,
                        "sort": "+updated",
                        "fields": "id,ts_fix_status,updated",
                    },
                    timeout=30,
                )

            if resp.status_code == 400 and "ts_fix_status" in resp.text:
                self.log("未找到字段 ts_fix_status，请先在 transcripts 集合里新增该字段", "ERROR")
                self.log("字段建议值：pending / pending_translate / processing / done / error", "INFO")
                return []

            resp.raise_for_status()
            return resp.json().get("items", [])

        except Exception as e:
            self.log(f"获取待处理任务失败: {e}", "WARNING")
            return []

    def set_fix_status(self, record_id, status):
        try:
            resp = self.session.patch(
                f"{self.pb_url}/api/collections/transcripts/records/{record_id}",
                json={"ts_fix_status": status},
                timeout=30,
            )
            resp.raise_for_status()
            return True
        except Exception as e:
            self.log(f"更新 {record_id} -> ts_fix_status={status} 失败: {e}", "WARNING")
            return False

    def process_task(self, task):
        record_id = task["id"]
        source_status = task.get("ts_fix_status", "pending")
        translation_only = source_status == "pending_translate"
        mode = "translation_only" if translation_only else "full"
        self.log(f"开始处理: {record_id} | mode={mode}", "PROCESS")

        # 先抢占任务
        if not self.set_fix_status(record_id, "processing"):
            self.log(f"跳过任务（无法置 processing）: {record_id}", "WARNING")
            return

        fixer = TimestampFixer(
            pb_url=self.pb_url,
            admin_email=self.admin_email,
            admin_password=self.admin_password,
        )

        ok = False
        for attempt in range(1, PROCESS_RETRIES + 1):
            try:
                ok = fixer.run(
                    record_id,
                    auto_upload=True,
                    mode=mode,
                    only_missing_translation=True,
                )
                if ok:
                    break
                self.log(f"任务 {record_id} 第{attempt}次执行未成功", "WARNING")
            except Exception as e:
                self.log(f"修复过程异常 {record_id}（第{attempt}次）: {e}", "ERROR")

            if attempt < PROCESS_RETRIES:
                sleep_s = RETRY_BACKOFF * (2 ** (attempt - 1))
                self.log(f"任务 {record_id} {sleep_s:.1f}s 后重试", "WARNING")
                time.sleep(sleep_s)

        if ok:
            self.set_fix_status(record_id, "done")
            self.log(f"处理完成: {record_id}", "SUCCESS")
        else:
            self.set_fix_status(record_id, "error")
            self.log(f"处理失败: {record_id}", "ERROR")

    def run(self):
        if not self.acquire_lock():
            return

        self.log("TS Fix Worker 启动（手动标记模式）", "INFO")
        self.log(f"PocketBase: {self.pb_url}", "INFO")
        self.log(f"Worker ID: {WORKER_ID}", "INFO")
        self.log(f"轮询间隔: {CHECK_INTERVAL}s", "INFO")

        if not self.login_admin():
            self.log("启动失败：登录失败", "ERROR")
            return

        self.log("监听条件：ts_fix_status in ['pending','pending_translate']", "INFO")

        while True:
            try:
                tasks = self.fetch_pending_tasks()
                if tasks:
                    self.log(f"发现 {len(tasks)} 个待修复任务", "INFO")
                    for task in tasks:
                        self.process_task(task)
                time.sleep(CHECK_INTERVAL)
            except KeyboardInterrupt:
                self.log("收到停止信号，Worker 退出", "INFO")
                break
            except Exception as e:
                self.log(f"主循环异常: {e}", "WARNING")
                time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    worker = TsFixWorker()
    worker.run()
