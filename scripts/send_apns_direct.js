
import apn from 'apn';
import PocketBase from 'pocketbase';
import fs from 'fs';

/**
 * 🍎 Native APNs Sender (v1.0) - 国内环境专用
 * 作用：直接对接苹果 APNs 服务器发送推送，不经过 Firebase，适合国内无 VPN 环境。
 * 
 * 准备工作：
 * 1. 在 Apple Developer 后台下载推送密钥 (.p8 文件)。
 * 2. 运行 npm install apn pocketbase
 */

// --- 配置区域 ---
const APNS_CONFIG = {
    token: {
        key: "./AuthKey_2F97ZJ3S6F.p8", // ✅ 已更新为您的实际文件名
        keyId: "2F97ZJ3S6F",  // ✅ 已更新为您的 Key ID
        teamId: "39726N3G73" // ✅ 已更新为您的 Team ID
    },
    production: false // 🛠️ 测试环境选 false，正式上架选 true
};

const BUNDLE_ID = "com.hardcore.language"; // ✅ 已更新为您的 Bundle ID
const PB_URL = 'https://zjcnex.top';

// --- 初始化 ---
const apnProvider = new apn.Provider(APNS_CONFIG);
const pb = new PocketBase(PB_URL);

/**
 * 发送单条测试消息
 * @param {string} deviceToken 苹果原生 APNs Token (64位十六进制)
 * @param {string} title 标题
 * @param {string} body 内容
 */
async function sendNativePush(deviceToken, title, body) {
    let note = new apn.Notification();
    note.expiry = Math.floor(Date.now() / 1000) + 3600; // 1小时有效期
    note.badge = 1;
    note.sound = "ping.aiff";
    note.alert = { title, body };
    note.topic = BUNDLE_ID;

    try {
        const result = await apnProvider.send(note, deviceToken);
        if (result.sent.length > 0) {
            console.log('✅ [APNs] 发送成功:', result.sent);
        } else {
            console.error('❌ [APNs] 发送失败:', result.failed);
        }
    } catch (e) {
        console.error('❌ [APNs] 脚本运行错误:', e);
    }
}

/**
 * 按版本群发 (APNs 版)
 */
async function broadcastToVersionNative(version, title, body) {
    try {
        const records = await pb.collection('users').getFullList({
            filter: `last_active_version = "${version}" && fcm_token != ""`
        });

        console.log(`🔍 [APNs] 找到 ${records.length} 个本地用户`);

        for (const user of records) {
            // 简单判断是否是 APNs Token (64位十六进制)
            if (user.fcm_token.length === 64) {
                console.log(`📡 正在通过 APNs 直连发送给: ${user.id}`);
                await sendNativePush(user.fcm_token, title, body);
            }
        }
    } catch (e) {
        console.error('❌ 批量筛选失败:', e);
    }
}

// 执行
const targetToken = process.argv[2];
if (targetToken) {
    sendNativePush(targetToken, "原生测试", "这是绕过 Firebase 直接从苹果发的！");
} else {
    console.log('💡 使用方法: node send_apns_direct.js <64位APNS_TOKEN>');
    // broadcastToVersionNative('1.10.7', '国内用户专属提醒', '不需要梯子也能收到消息啦！');
}
