# sort: 1
# 宝塔面板 (BT Panel) Redis 检查手册

请登录宝塔面板，打开 **终端**，逐一执行以下命令。

## 1. 检查 Redis 服务状态
首先确认 Redis 服务是否已启动。

```bash
ps aux | grep redis
```

-   **正常结果**：应该看到一行带有 `/www/server/redis/src/redis-server` 或 similar (端口 *:6379) 的进程。
-   **异常情况**：如果没有输出任何 redis-server 进程，说明 Redis 没开。
    -   *修复*：去宝塔“软件商店” -> “Redis” -> 点击“启动”。

---

## 2. 定位项目目录
你需要进入到你的 PocketBase 程序所在的目录。通常在 `/www/wwwroot/` 下面。

```bash
# 请将 your-project-folder 替换为你的实际文件夹名
cd /www/wwwroot/your-project-folder
```

确认你进对了地方：执行 `ls -F`，你应该能看到 `pb_hooks/` 这个文件夹。

---

## 3. 检查 pb_hooks 依赖
这是最关键的一步。PocketBase 的 JS 钩子是独立运行的，Redis 插件需要安装在 `pb_hooks` 目录下。

```bash
cd pb_hooks
npm list ioredis
```

-   **正常结果**：显示 `ioredis@5.x.x` (类似这样的版本号)。
-   **异常结果**：显示 `(empty)` 或 `npm ERR! ...`。

### 修复依赖缺失 (重点!)
如果上面显示没有安装，请执行以下命令来安装它：

```bash
# 确保在 pb_hooks 目录下
npm install ioredis
```

安装完成后，**必须重启 PocketBase 服务** 才能生效。
（如果是用 Supervisor 管理的，去 Supervisor 管理器里重启一下该进程）。

---

## 4. 验证脚本 (可选)
如果不确定好没好，可以在 `pb_hooks` 目录下创建一个测试文件：

```bash
echo "const Redis = require('ioredis'); const redis = new Redis(); redis.ping().then(console.log).catch(console.error);" > test_redis.js
node test_redis.js
```
-   **成功**：输出 `PONG`。
-   **失败**：输出错误信息。

做完测试后删掉它：`rm test_redis.js`
