
import admin from 'firebase-admin';
import PocketBase from 'pocketbase';
import fs from 'fs';
import path from 'path';

/**
 * 🚀 Push Notification Sender (v1.0)
 * 作用：从 PocketBase 筛选用户，并批量发送推送通知
 * 
 * 准备工作：
 * 1. 在 Firebase 控制台 -> 项目设置 -> 服务账号 -> 生成新的私钥。
 * 2. 将下载的 JSON 重命名为 `service-account.json` 放到脚本同级目录。
 * 3. 运行 npm install firebase-admin pocketbase
 */

// --- 配置区域 ---
const PB_URL = 'https://zjcnex.top';
const SERVICE_ACCOUNT_PATH = './service-account.json';

// 初始化 Firebase
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('❌ 错误：找不到 service-account.json 文件。请参考脚本注释进行配置。');
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const pb = new PocketBase(PB_URL);

/**
 * 发送单条测试消息
 * @param {string} token FCM Token 或 APNs Token
 * @param {string} title 标题
 * @param {string} body 内容
 */
async function sendToToken(token, title, body) {
    const message = {
        notification: {
            title: title,
            body: body
        },
        token: token,
        // 🔥 针对原生 APNs Token，这一段配置是必须的
        apns: {
            headers: {
                'apns-topic': 'com.hardcore.language', // ✅ 已更新为您的 Bundle ID
                'apns-priority': '10'
            },
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1
                }
            }
        }
    };

    try {
        const response = await admin.messaging().send(message);
        console.log('✅ 发送成功:', response);
    } catch (error) {
        console.error('❌ 发送失败:', error);
        if (error.code === 'messaging/registration-token-not-registered') {
            console.error('   提示：该 Token 已失效或未在 Firebase 中配置 APNs 证书。');
        }
    }
}

/**
 * 按版本筛选并群发
 * @param {string} version 版本号 (如 "1.10.7")
 */
async function broadcastToVersion(version, title, body) {
    try {
        // 从 PB 筛选用户
        const records = await pb.collection('users').getFullList({
            filter: `last_active_version = "${version}" && fcm_token != ""`
        });

        console.log(`🔍 找到 ${records.length} 个版本为 ${version} 的用户`);

        for (const user of records) {
            console.log(`📡 正在发送给用户: ${user.username || user.id}`);
            await sendToToken(user.fcm_token, title, body);
        }
    } catch (e) {
        console.error('❌ 批量筛选失败:', e);
    }
}

// --- 执行区域 ---
// 示例 1: 给您刚才抓到的那个特定 Token 发测试
const testToken = process.argv[2] || '替换为你的Token';
if (testToken && testToken !== '替换为你的Token') {
    sendToToken(testToken, '测试标题', '看到这条消息说明你的推送通了！');
} else {
    // 示例 2: 给所有 1.10.7 的用户群发
    // broadcastToVersion('1.10.7', '新版本提醒', '快来看看我们的新功能！');
    console.log('💡 使用方法：node send_push.js <YOUR_TOKEN>');
}
