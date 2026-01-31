import { useState, useEffect, useMemo, useRef } from 'react';
import { materialService } from '@/lib/materialService';
import { pb } from '@/lib/api';
import type { Material } from '@/data/types';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';

/**
 * Daily Spark Hook - 方案3：确定性实时选择
 * 
 * 核心思路：
 * 1. 不缓存"今天选了哪条"（避免日期同步问题）
 * 2. 只缓存"用户读过哪些"（已读历史）
 * 3. 每次基于 [日期 + 未读材料池] 确定性计算
 * 4. 同步初始化，立即显示内容（无空白屏）
 * 
 * 优势：
 * - ✅ 首次安装：立即显示内置材料（0延迟）
 * - ✅ 跨日切换：自动重新计算（无需清缓存）
 * - ✅ 同日稳定：哈希算法保证同一天返回同一条
 * - ✅ 避免重复：自动过滤已读材料
 */
export function useDailySpark() {
    // 1️⃣ 同步获取所有材料（内置 + 缓存）
    const [allMaterials, setAllMaterials] = useState<Material[]>(() => {
        // 同步初始化：优先使用内置材料
        return materialService.getBundledOnly();
    });

    // 2️⃣ 已读历史（异步加载，初始为空）
    const [readHistory, setReadHistory] = useState<string[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);

    // 🔥 NEW: Store authoritative user progress to prevent overwrite by stale cache
    const progressRef = useRef<Map<string, any>>(new Map());

    // Helper: Apply known progress to materials
    const applyProgress = (materials: Material[]) => {
        if (progressRef.current.size === 0) return materials;

        return materials.map(m => {
            const prog = progressRef.current.get(m.id);
            if (prog) {
                return {
                    ...m,
                    userMeta: {
                        currentStep: prog.current_step || 0,
                        isStarred: prog.is_starred || false,
                        isPinned: prog.is_pinned || false,
                        isOffline: m.userMeta?.isOffline || false,
                        updatedAt: prog.updated || m.userMeta?.updatedAt || new Date().toISOString()
                    }
                };
            }
            return m;
        });
    };

    /**
     * 加载已读历史
     */
    const loadReadHistory = async () => {
        try {
            const { value } = await Preferences.get({ key: 'daily_spark_read_history' });
            const history = value ? JSON.parse(value) : [];
            setReadHistory(history);
        } catch (e) {
            setReadHistory([]);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    /**
     * 加载缓存快照（后台静默更新）
     */
    const loadCachedMaterials = async () => {
        try {
            const cached = await materialService.getCachedSnapshot();
            if (cached && cached.length > 0) {
                console.log(`📦 [Daily Spark] Updated from cache: ${cached.length} materials`);
                // 🔥 FIX: Apply progressRef after merge
                setAllMaterials(prev => {
                    const merged = materialService.mergeMaterials(prev, cached);
                    return applyProgress(merged);
                });
            }
        } catch (e) {
            console.error('[Daily Spark] Failed to load cache:', e);
        }
    };

    /**
     * 从数据库加载用户进度（修复步骤条不亮问题）
     */
    const loadUserProgress = async () => {
        try {
            const { fetchUserProgress } = await import('@/lib/api');
            const progressList = await fetchUserProgress();

            if (progressList && progressList.length > 0) {
                console.log(`📊 [Daily Spark] Fetched ${progressList.length} user progress records`);

                // Update authoritative ref
                progressList.forEach((p: any) => progressRef.current.set(p.material_id, p));

                // Force update state
                setAllMaterials(prev => applyProgress(prev));
            }
        } catch (e) {
            console.warn('[Daily Spark] Failed to load user progress:', e);
        }
    };

    /**
     * 从服务器加载 Daily Spark 材料（后台异步）
     */
    const loadRemoteMaterials = async () => {
        try {
            const remote = await materialService.loadDailySparkMaterials();

            if (remote && remote.length > 0) {
                setAllMaterials(prev => {
                    const merged = materialService.mergeMaterials(prev, remote);
                    return applyProgress(merged);
                });
            }
        } catch (e) {
            console.warn('[Daily Spark] Failed to load remote materials:', e);
        }
    };

    /**
     * 标记当前材料为已读
     */
    const markAsRead = async (materialId: string) => {
        if (readHistory.includes(materialId)) return;

        const newHistory = [...readHistory, materialId];
        setReadHistory(newHistory);

        try {
            await Preferences.set({
                key: 'daily_spark_read_history',
                value: JSON.stringify(newHistory)
            });
        } catch (e) {
            console.error('[Daily Spark] Failed to save read history:', e);
        }
    };

    // 4️⃣ 确定性选择算法（核心逻辑 + 当日锁定）
    const material = useMemo(() => {
        const businessDate = getBeijingBusinessDate();
        const candidates = allMaterials.filter(m => m.location === 'daily_spark');

        // ... (rest of logic same until return) ...
        if (candidates.length === 0) {
            console.warn('⚠️ [Daily Spark] No daily_spark materials available');
            return null;
        }

        // 🔒 关键优化：检查今日是否已锁定选择
        const lockedDate = sessionStorage.getItem('daily_spark_locked_date');
        const lockedId = sessionStorage.getItem('daily_spark_locked_id');

        if (lockedDate === businessDate && lockedId) {
            const locked = candidates.find(m => m.id === lockedId);
            if (locked) {
                return locked;
            }
        }

        const unread = candidates.filter(m => !readHistory.includes(m.id));

        if (unread.length === 0) {
            const selected = selectByDateHash(businessDate, candidates);
            if (selected) {
                sessionStorage.setItem('daily_spark_locked_date', businessDate);
                sessionStorage.setItem('daily_spark_locked_id', selected.id);
            }
            return selected;
        }

        const selected = selectByDateHash(businessDate, unread);
        if (selected) {
            sessionStorage.setItem('daily_spark_locked_date', businessDate);
            sessionStorage.setItem('daily_spark_locked_id', selected.id);
        }
        return selected;

    }, [allMaterials, readHistory]);

    // 3️⃣ 加载已读历史 + 缓存快照 + 在线材料 + 用户进度
    // 🔄 监听 Auth 状态：当用户登录/Token恢复时，重新加载进度
    // 🔄 监听 Network 状态：网络恢复时重试
    useEffect(() => {
        loadReadHistory();
        loadCachedMaterials();
        loadRemoteMaterials();
        loadUserProgress();

        // Network Listener
        let networkListener: any;
        const setupListener = async () => {
            networkListener = await Network.addListener('networkStatusChange', status => {
                if (status.connected) {
                    console.log('📡 [Daily Spark] Network connected, retrying progress load...');
                    loadUserProgress();
                    loadRemoteMaterials();
                }
            });
        };
        setupListener();

        return () => {
            if (networkListener) networkListener.remove();
        };
    }, [pb.authStore.isValid, pb.authStore.model?.id]);

    // 5️⃣ 自愈机制：如果确定了今天要显示的材料，但进度为0，尝试一次“点对点”的精准修复
    useEffect(() => {
        if (!material || !pb.authStore.isValid || !pb.authStore.model?.id) return;

        // 如果当前显示的进度是0 (未读)，但用户可能实际上读过 (比如缓存覆盖了)
        // 我们发起一次独立的、针对该ID的查询
        if (material.userMeta?.currentStep === 0) {
            const materialId = material.id;
            const userId = pb.authStore.model.id;

            // 延迟一点点执行，避开高并发启动期
            const timer = setTimeout(async () => {
                try {
                    console.log(`🩺 [Self-Healing] Checking progress for ${materialId}...`);
                    // 精准查询：只查这一条
                    const record = await pb.collection('user_progress').getFirstListItem(`user="${userId}" && material_id="${materialId}"`);

                    if (record && record.current_step > 0) {
                        console.log(`💊 [Self-Healing] Found missing progress! ${record.current_step} steps. Applying fix...`);

                        // 1. 更新权威Ref
                        progressRef.current.set(materialId, record);

                        // 2. 强制刷新UI
                        setAllMaterials(prev => applyProgress(prev));
                    } else {
                        console.log('🩺 [Self-Healing] Confirmed progress is effectively 0.');
                    }
                } catch (e: any) {
                    // 404 is expected if truly new
                    if (e.status !== 404) {
                        console.warn('⚠️ [Self-Healing] Check failed:', e);
                    }
                }
            }, 500); // 500ms delay

            return () => clearTimeout(timer);
        }
    }, [material?.id, material?.userMeta?.currentStep]); // 监听ID和进度变化

    return {
        material,
        isLoading: isLoadingHistory,
        markAsRead,
        readHistory
    };
}

// ==================== 工具函数 ====================

/**
 * 计算北京时间业务日期（5AM切换）
 */
function getBeijingBusinessDate(): string {
    const now = new Date();
    // 减去5小时：凌晨0-5点算作前一天
    const adjustedTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    return adjustedTime.toLocaleDateString('en-CA'); // "YYYY-MM-DD"
}

/**
 * 基于日期哈希的确定性选择
 * @param date 业务日期，如 "2026-01-23"
 * @param candidates 候选材料列表
 */
function selectByDateHash(date: string, candidates: Material[]): Material | null {
    if (candidates.length === 0) return null;

    // 日期转数字哈希：20260123
    const dateHash = parseInt(date.replace(/-/g, ''));

    // 取模选择索引
    const index = dateHash % candidates.length;

    console.log(`🎲 [Daily Spark] Date ${date} → Hash ${dateHash} → Index ${index}/${candidates.length}`);

    return candidates[index];
}
