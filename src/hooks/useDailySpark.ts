import { useState, useEffect, useRef } from 'react';
import { materialService } from '@/lib/materialService';
import type { Material } from '@/data/types';
import { Preferences } from '@capacitor/preferences';
import { pb } from '@/lib/api';
import { BUNDLED_MATERIALS } from '@/data/bundled_materials';

/**
 * Daily Spark Hook - 新策略版本
 * 规则：
 * 1. 首次安装 → 使用bundled材料，这一天不变
 * 2. 第二天5点后 → Redis(<100ms) → 老方法(3-5秒)
 * 3. 超时 → 静默失败，显示旧材料
 * 4. 刷新 → 杀死app重进时自动重试
 */
export function useDailySpark() {
    const [material, setMaterial] = useState<Material | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const hasInitialized = useRef(false);

    useEffect(() => {
        if (hasInitialized.current) return;
        hasInitialized.current = true;
        loadDailySpark();
    }, []);

    /**
     * 计算当前的"业务日期" (北京时间 5AM 周期)
     */
    const getBeijingBusinessDate = (): string => {
        const now = new Date();
        const adjustedTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
        return adjustedTime.toLocaleDateString('en-CA'); // "YYYY-MM-DD"
    };

    const loadDailySpark = async () => {
        const targetDateStr = getBeijingBusinessDate();
        console.log(`[Daily Spark] Target business date: ${targetDateStr}`);

        try {
            // 1️⃣ 检查是否首次安装
            const firstInstallDate = await getFirstInstallDate();

            if (!firstInstallDate) {
                // 🎉 首次安装：使用bundled材料
                console.log('🎉 [Daily Spark] First install - using bundled material');
                const bundledMaterial = getBundledDailySpark();

                if (bundledMaterial) {
                    setMaterial(bundledMaterial);
                    await saveDailySparkCache(bundledMaterial, targetDateStr);
                    await setFirstInstallDate(targetDateStr);
                    setIsLoading(false);
                    return;
                } else {
                    console.warn('⚠️ No bundled Daily Spark found, will try remote...');
                    await setFirstInstallDate(targetDateStr);
                }
            }

            // 2️⃣ 检查缓存是否有效（同一天）
            const cached = await getCachedDailySpark();

            if (cached && cached.dateString === targetDateStr) {
                console.log('✅ [Daily Spark] Cache hit');
                setMaterial(cached.material);
                setIsLoading(false);
                return;
            }

            // 3️⃣ 跨天了，需要更新
            console.log('📅 [Daily Spark] New day, fetching fresh material...');
            // 先显示旧的/bundled（用户立即有内容可看）
            setMaterial(cached?.material || getBundledDailySpark());
            setIsLoading(true);

            try {
                // 🚀 尝试Redis (2秒超时)
                const response = await fetchWithTimeout(
                    pb.send('/api/daily-spark', {}),
                    2000
                );

                if (response?.id) {
                    console.log(`✅ [Daily Spark] Redis success: ${response.id}`);
                    const material = {
                        ...response,
                        userMeta: {
                            isStarred: false,
                            isPinned: false,
                            currentStep: 0,
                            isOffline: false,
                            updatedAt: response.createdAt || new Date().toISOString()
                        }
                    };

                    setMaterial(material);
                    await saveDailySparkCache(material, targetDateStr);
                    setIsLoading(false);
                    return;
                }
            } catch {
                console.warn('⚠️ Redis failed, trying legacy...');
            }

            try {
                // 🔄 Fallback: 老方法 (10秒超时)
                const freshMaterials = await fetchWithTimeout(
                    materialService.loadDailySparkMaterials(),
                    10000
                );

                const freshItem = freshMaterials.find((m: Material) => m.location === 'daily_spark');

                if (freshItem) {
                    console.log(`✅ [Daily Spark] Legacy success: ${freshItem.id}`);
                    setMaterial(freshItem);
                    await saveDailySparkCache(freshItem, targetDateStr);
                    setIsLoading(false);
                    return;
                }
            } catch {
                console.error('❌ Legacy method also failed');
            }

            // 4️⃣ 都失败了：静默失败，保留旧材料
            console.log('⚠️ [Daily Spark] All methods failed, keeping old material');
            setIsLoading(false);
            // material已经是cached?.material或bundled

        } catch (e) {
            console.error('[Daily Spark] Unexpected error:', e);
            setIsLoading(false);
        }
    };

    return { material, isLoading, reload: loadDailySpark };
}

// ==================== 工具函数 ====================

/**
 * Promise超时包装器
 */
function fetchWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), ms)
        )
    ]);
}

/**
 * 获取首次安装日期
 */
async function getFirstInstallDate(): Promise<string | null> {
    try {
        const { value } = await Preferences.get({ key: 'daily_spark_first_install_date' });
        return value;
    } catch (e) {
        console.error('Failed to get first install date:', e);
        return null;
    }
}

/**
 * 设置首次安装日期
 */
async function setFirstInstallDate(date: string): Promise<void> {
    try {
        await Preferences.set({ key: 'daily_spark_first_install_date', value: date });
        console.log(`📅 [Daily Spark] First install date set: ${date}`);
    } catch (e) {
        console.error('Failed to set first install date:', e);
    }
}

/**
 * 获取bundled Daily Spark材料
 */
function getBundledDailySpark(): Material | null {
    const bundled = BUNDLED_MATERIALS.find(m => m.location === 'daily_spark');

    if (!bundled) {
        console.warn('⚠️ No bundled Daily Spark found in BUNDLED_MATERIALS');
        return null;
    }

    return {
        ...bundled,
        userMeta: {
            isStarred: false,
            isPinned: false,
            currentStep: 0,
            isOffline: true,
            updatedAt: new Date().toISOString()
        }
    };
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
