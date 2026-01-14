import { useState, useEffect } from 'react';
import { materialService } from '@/lib/materialService';
import type { Material } from '@/data/types';
import { Preferences } from '@capacitor/preferences';

/**
 * Daily Spark Hook - 严格日期验证版本
 * 规则：北京时间 05:00 AM 为每日更新时间
 * - 如果当前时间 < 05:00: 属于昨天的周期
 * - 如果当前时间 >= 05:00: 属于今天的周期
 */
export function useDailySpark() {
    const [material, setMaterial] = useState<Material | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadDailySpark();
    }, []);

    /**
     * 计算当前的"业务日期" (北京时间 5AM 周期)
     * 逻辑：当前时间减去 5 小时，取日期字符串
     */
    const getBeijingBusinessDate = (): string => {
        const now = new Date();
        // 减去 5 小时来模拟 5AM 边界
        // 例：1月13日 04:00 -> 减5h -> 1月12日 23:00 -> 返回 "2026-01-12"
        // 例：1月13日 06:00 -> 减5h -> 1月13日 01:00 -> 返回 "2026-01-13"
        const adjustedTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
        return adjustedTime.toLocaleDateString('en-CA'); // "YYYY-MM-DD"
    };

    const loadDailySpark = async () => {
        const targetDateStr = getBeijingBusinessDate();
        console.log(`[Daily Spark] Target business date: ${targetDateStr}`);

        try {
            // 1. 快速 IO: 读取缓存
            const cached = await getCachedDailySpark();

            // 2. 严格日期校验
            if (cached && cached.dateString === targetDateStr) {
                console.log("✅ [Daily Spark] Cache hit - Valid for current cycle");
                setMaterial(cached.material);
                setIsLoading(false);
                return;
            }

            // 3. 缓存过期或不存在：显示骨架屏并请求新数据
            console.log(`⏳ [Daily Spark] Cache stale/missing. Fetching for ${targetDateStr}...`);
            setMaterial(null); // 🔥 关键：不显示旧数据
            setIsLoading(true);

            // 4. 从服务器获取新数据
            // ⚠️ TODO: 集成新的预计算 API
            // 当前状态 (2026-01-14):
            //   - ✅ 后端已部署: /api/daily-spark (Redis 预计算，<100ms)
            //   - ❌ 前端未调用: 仍使用老方法 loadDailySparkMaterials() (3-5秒)
            //   - 📝 原因: 等待后端验证通过后再切换
            //
            // 推荐改造 (带 Fallback):
            // try {
            //   const response = await pb.send('/api/daily-spark', {});
            //   if (response?.id) {
            //     setMaterial(response);
            //     await saveDailySparkCache(response, targetDateStr);
            //     return;
            //   }
            // } catch (apiError) {
            //   console.warn('API failed, using fallback');
            // }
            // // Fallback to legacy method
            //
            // 收益: API 正常时 <100ms, 失败时自动降级到 3-5秒，零风险
            const freshMaterials = await materialService.loadDailySparkMaterials();
            const freshItem = freshMaterials.find(m => m.location === 'daily_spark');

            if (freshItem) {
                setMaterial(freshItem);
                // 保存到缓存，打上当前业务日期标签
                await saveDailySparkCache(freshItem, targetDateStr);
                console.log(`✅ [Daily Spark] Loaded and cached: ${freshItem.id}`);
            } else {
                console.warn('⚠️ [Daily Spark] No material found');
            }
        } catch (e) {
            console.error('[Daily Spark] Load failed:', e);
        } finally {
            setIsLoading(false);
        }
    };

    return { material, isLoading, reload: loadDailySpark };
}

/**
 * 读取 Daily Spark 缓存
 */
async function getCachedDailySpark(): Promise<{ dateString: string; material: Material } | null> {
    try {
        const { value: dateStr } = await Preferences.get({ key: 'daily_spark_cache_date' });
        const { value: materialStr } = await Preferences.get({ key: 'daily_spark_cache_material' });

        if (!dateStr || !materialStr) return null;

        return {
            dateString: dateStr,
            material: JSON.parse(materialStr)
        };
    } catch (e) {
        console.error('Failed to read Daily Spark cache:', e);
        return null;
    }
}

/**
 * 保存 Daily Spark 缓存
 */
async function saveDailySparkCache(material: Material, dateString: string): Promise<void> {
    try {
        await Promise.all([
            Preferences.set({ key: 'daily_spark_cache_date', value: dateString }),
            Preferences.set({ key: 'daily_spark_cache_material', value: JSON.stringify(material) })
        ]);
        console.log(`💾 [Daily Spark] Cached for ${dateString}`);
    } catch (e) {
        console.error('Failed to save Daily Spark cache:', e);
    }
}
