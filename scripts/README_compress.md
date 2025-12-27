# 📷 批量图片压缩工具

专为手机大卡片显示优化的图片压缩脚本。

## ✨ 特点

- **🎯 智能尺寸调整**: 自动调整到 1200px 宽度，完美适配手机大卡片
- **🗜️ 高效压缩**: 使用 WebP 格式，文件体积减少 60-80%，同时保持高清晰度
- **🚀 批量处理**: 一次性处理整个文件夹的所有图片
- **📊 详细统计**: 显示每个文件的压缩比例和总体统计信息

## 📋 系统要求

- Node.js 14+ 
- npm 或 yarn

## 🔧 安装

首先安装依赖包：

```bash
cd /Users/geo/Downloads/hardcoreEnglish
npm install sharp
```

## 🚀 使用方法

### 基本用法

```bash
# 压缩 ./images 文件夹中的所有图片，输出到 ./images_compressed
node scripts/compress_images.js ./images ./images_compressed
```

### 示例

```bash
# 压缩项目中的图片
node scripts/compress_images.js ./assets/images ./assets/images_optimized

# 压缩下载的图片
node scripts/compress_images.js ~/Downloads/photos ./compressed_photos
```

## ⚙️ 配置说明

你可以在脚本中修改 `CONFIG` 对象来调整参数：

```javascript
const CONFIG = {
  // 目标宽度 - 手机大卡片推荐 1200px
  targetWidth: 1200,
  
  // WebP 质量 (1-100) - 85 是最佳平衡点
  webpQuality: 85,
  
  // JPEG 质量（如果需要 jpg 格式）
  jpegQuality: 85,
  
  // 输出格式: 'webp' | 'jpeg' | 'original'
  outputFormat: 'webp'
};
```

### 不同使用场景的推荐配置

#### 场景 1: 手机大卡片（默认配置）✅
```javascript
targetWidth: 1200,
webpQuality: 85,
outputFormat: 'webp'
```
- 适合：App 首页卡片、列表缩略图
- 效果：高清晰度 + 小文件体积

#### 场景 2: 全屏展示
```javascript
targetWidth: 1600,
webpQuality: 90,
outputFormat: 'webp'
```
- 适合：详情页大图、全屏查看
- 效果：超高清晰度

#### 场景 3: 兼容性优先
```javascript
targetWidth: 1200,
jpegQuality: 85,
outputFormat: 'jpeg'
```
- 适合：需要兼容老设备或特殊需求
- 效果：JPEG 格式，通用性好

## 📊 压缩效果

典型的压缩效果：

| 原始格式 | 原始大小 | 压缩后大小 | 减少比例 | 清晰度 |
|---------|---------|-----------|---------|--------|
| JPG     | 2.5 MB  | 180 KB    | 93%     | ⭐⭐⭐⭐⭐ |
| PNG     | 4.8 MB  | 220 KB    | 95%     | ⭐⭐⭐⭐⭐ |
| WEBP    | 1.2 MB  | 150 KB    | 87%     | ⭐⭐⭐⭐⭐ |

## 🎨 支持的格式

### 输入格式
- `.jpg` / `.jpeg`
- `.png`
- `.webp`

### 输出格式
- `webp` (推荐) - 最佳压缩比
- `jpeg` - 通用兼容性
- `original` - 保持原格式

## 💡 使用技巧

### 1. 查看压缩效果
脚本会自动显示每个文件的压缩详情：
```
处理: example.jpg
  原始尺寸: 3000x2000
  原始大小: 2500.00 KB
  压缩后尺寸: 1200x800
  压缩后大小: 180.50 KB
  文件减小: 92.78%
  ✅ 完成
```

### 2. 批量处理多个文件夹
```bash
# 创建一个简单的批处理脚本
for dir in images1 images2 images3; do
  node scripts/compress_images.js ./$dir ./${dir}_compressed
done
```

### 3. 只压缩不调整尺寸
如果你的图片已经是合适的尺寸，可以设置：
```javascript
targetWidth: 999999, // 设置一个很大的值，图片就不会被调整尺寸
```

## ❓ 常见问题

### Q: WebP 格式在 iOS 上支持吗？
A: 完全支持！iOS 14+ 和 Safari 14+ 都原生支持 WebP。

### Q: 如何在 React Native / Capacitor 中使用？
A: 直接使用就可以，就像普通图片一样：
```jsx
<img src="./images_compressed/photo.webp" />
```

### Q: 压缩会损失质量吗？
A: 质量设置为 85 时，人眼几乎看不出差别，但文件体积会大幅减小。

### Q: 可以处理更大的图片吗？
A: 可以！sharp 库可以处理超大图片。如果遇到内存问题，可以设置：
```bash
NODE_OPTIONS=--max-old-space-size=4096 node scripts/compress_images.js
```

## 🔗 相关资源

- [Sharp 官方文档](https://sharp.pixelplumbing.com/)
- [WebP 格式介绍](https://developers.google.com/speed/webp)
- [移动端图片优化最佳实践](https://web.dev/fast/#optimize-your-images)

## 📝 许可证

MIT
