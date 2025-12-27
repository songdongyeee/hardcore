/**
 * 波形缓存管理工具
 * 使用localStorage缓存压缩波形数据，减少网络流量
 */

const CACHE_PREFIX = 'waveform_v1_';
const MAX_CACHE_SIZE = 50; // 最多缓存50个波形

export interface CompressedWaveform {
    data: number[][];  // [[0, 128], [0, 200], ...] 压缩格式
    duration: number;
    timestamp: number;
}

/**
 * 解析 duration，兼容 number 和 string (如 "12:49")
 */
function parseDuration(d: any): number {
    if (typeof d === 'number') return d;
    if (typeof d === 'string') {
        if (d.includes(':')) {
            const parts = d.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1]; // MM:SS
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
        }
        return parseFloat(d) || 0;
    }
    return 0;
}

/**
 * 解压波形数据（只提取 max 值，归一化 0-1）
 */
function decompressWaveform(compressed: number[][]): number[] {
    return compressed.map(([, max]) => max / 255);
}

/**
 * 获取缓存的波形数据
 */
export async function getCachedWaveform(id: string): Promise<{ peaks: number[], duration: number } | null> {
    try {
        const key = CACHE_PREFIX + id;
        const cached = localStorage.getItem(key);

        if (!cached) {
            return null;
        }

        const parsed: CompressedWaveform = JSON.parse(cached);
        const parsedDuration = parseDuration(parsed.duration);

        console.log(`[WaveformCache] Hit for ${id}, ${parsed.data.length} peaks, duration: ${parsedDuration} (raw: ${parsed.duration})`);
        return {
            peaks: decompressWaveform(parsed.data),
            duration: parsedDuration
        };
    } catch (e) {
        console.error('[WaveformCache] Failed to read cache:', e);
        return null;
    }
}

/**
 * 缓存波形数据
 */
export async function cacheWaveform(
    id: string,
    compressed: number[][],
    duration: number | string
): Promise<void> {
    try {
        const key = CACHE_PREFIX + id;
        const cleanDuration = parseDuration(duration);

        const data: CompressedWaveform = {
            data: compressed,
            duration: cleanDuration,
            timestamp: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(data));
        console.log(`[WaveformCache] Cached ${id}, ${compressed.length} peaks, ${(JSON.stringify(data).length / 1024).toFixed(1)} KB`);

        // 清理旧缓存
        cleanupOldCache();
    } catch (e) {
        console.error('[WaveformCache] Failed to cache:', e);

        // 如果localStorage满了，强制清理
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            console.warn('[WaveformCache] Quota exceeded, clearing old cache');
            clearOldCache();

            // 重试
            try {
                const retryKey = CACHE_PREFIX + id;
                localStorage.setItem(retryKey, JSON.stringify({ data: compressed, duration, timestamp: Date.now() }));
            } catch (retryError) {
                console.error('[WaveformCache] Retry failed:', retryError);
            }
        }
    }
}

/**
 * 清理旧缓存（保留最近的MAX_CACHE_SIZE个）
 */
function cleanupOldCache(): void {
    try {
        const keys = Object.keys(localStorage);
        const waveformKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));

        if (waveformKeys.length <= MAX_CACHE_SIZE) {
            return;
        }

        // 获取所有缓存及其时间戳
        const caches = waveformKeys.map(key => {
            try {
                const data = JSON.parse(localStorage.getItem(key) || '{}');
                return { key, timestamp: data.timestamp || 0 };
            } catch {
                return { key, timestamp: 0 };
            }
        });

        // 按时间戳排序
        caches.sort((a, b) => a.timestamp - b.timestamp);

        // 删除最旧的
        const toDelete = caches.slice(0, caches.length - MAX_CACHE_SIZE);
        toDelete.forEach(({ key }) => localStorage.removeItem(key));

        if (toDelete.length > 0) {
            console.log(`[WaveformCache] Cleaned up ${toDelete.length} old caches`);
        }
    } catch (e) {
        console.error('[WaveformCache] Cleanup failed:', e);
    }
}

/**
 * 强制清除所有波形缓存
 */
function clearOldCache(): void {
    try {
        const keys = Object.keys(localStorage);
        const waveformKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));

        // 删除一半
        const toDelete = waveformKeys.slice(0, Math.floor(waveformKeys.length / 2));
        toDelete.forEach(key => localStorage.removeItem(key));

        console.log(`[WaveformCache] Cleared ${toDelete.length} caches`);
    } catch (e) {
        console.error('[WaveformCache] Clear failed:', e);
    }
}

/**
 * 清除指定ID的缓存
 */
export function clearWaveformCache(id: string): void {
    const key = CACHE_PREFIX + id;
    localStorage.removeItem(key);
    console.log(`[WaveformCache] Cleared ${id}`);
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): { count: number; totalSize: number } {
    try {
        const keys = Object.keys(localStorage);
        const waveformKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));

        let totalSize = 0;
        waveformKeys.forEach(key => {
            const value = localStorage.getItem(key);
            if (value) {
                totalSize += value.length;
            }
        });

        return {
            count: waveformKeys.length,
            totalSize: totalSize
        };
    } catch (e) {
        return { count: 0, totalSize: 0 };
    }
}
