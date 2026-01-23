import { useState, useEffect, useMemo } from 'react';
import { materialService } from '@/lib/materialService';
import type { Material } from '@/data/types';
import { Preferences } from '@capacitor/preferences';

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

    // 3️⃣ 加载已读历史 + 缓存快照 + 在线材料 + 用户进度
    useEffect(() => {
        loadReadHistory();
        loadCachedMaterials();
        loadRemoteMaterials(); // 🆕 后台加载服务器材料
        loadUserProgress(); // 🔥 NEW: 加载用户进度，确保步骤条正确显示
    }, []);

    // 4️⃣ 确定性选择算法（核心逻辑 + 当日锁定）
    const material = useMemo(() => {
        const businessDate = getBeijingBusinessDate();
        const candidates = allMaterials.filter(m => m.location === 'daily_spark');

        if (candidates.length === 0) {
            console.warn('⚠️ [Daily Spark] No daily_spark materials available');
            return null;
        }

        // 🔒 关键优化：检查今日是否已锁定选择
        const lockedDate = sessionStorage.getItem('daily_spark_locked_date');
        const lockedId = sessionStorage.getItem('daily_spark_locked_id');

        if (lockedDate === businessDate && lockedId) {
            // 今天已选择，直接返回锁定的材料（即使材料池扩展也不变）
            const locked = candidates.find(m => m.id === lockedId);
            if (locked) {
                console.log(`🔒 [Daily Spark] Using locked selection: ${lockedId}`);
                return locked;
            }
            // 如果锁定的材料不在候选列表中（极端情况），重新选择
            console.warn('⚠️ [Daily Spark] Locked material not found, reselecting...');
        }

        // 过滤掉已读的
        const unread = candidates.filter(m => !readHistory.includes(m.id));

        if (unread.length === 0) {
            console.log('🔄 [Daily Spark] All materials read, restarting rotation');
            // 全读完了，重新开始
            const selected = selectByDateHash(businessDate, candidates);

            // 锁定选择
            if (selected) {
                sessionStorage.setItem('daily_spark_locked_date', businessDate);
                sessionStorage.setItem('daily_spark_locked_id', selected.id);
                console.log(`🔒 [Daily Spark] Locked selection: ${selected.id}`);
            }

            return selected;
        }

        // 基于日期确定性选择
        const selected = selectByDateHash(businessDate, unread);

        // 🔒 锁定今日选择（防止材料池扩展导致切换）
        if (selected) {
            sessionStorage.setItem('daily_spark_locked_date', businessDate);
            sessionStorage.setItem('daily_spark_locked_id', selected.id);
            console.log(`✅ [Daily Spark] Selected and locked for ${businessDate}:`, selected.id);
        }

        return selected;
    }, [allMaterials, readHistory]);

    /**
     * 加载已读历史
     */
    const loadReadHistory = async () => {
        try {
            const { value } = await Preferences.get({ key: 'daily_spark_read_history' });
            const history = value ? JSON.parse(value) : [];
            console.log(`📚 [Daily Spark] Loaded read history: ${history.length} items`);
            setReadHistory(history);
        } catch (e) {
            console.error('[Daily Spark] Failed to load read history:', e);
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
                // 🔥 FIX: 使用 mergeMaterials 合并，避免覆盖内置材料
                setAllMaterials(prev => materialService.mergeMaterials(prev, cached));
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

                // 创建进度映射表
                const progressMap = new Map();
                progressList.forEach((p: any) => progressMap.set(p.material_id, p));

                // 更新 allMaterials 中的 userMeta
                setAllMaterials(prev => prev.map(m => {
                    const prog = progressMap.get(m.id);
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
                }));

                console.log('✅ [Daily Spark] User progress merged into materials');
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
            console.log('📡 [Daily Spark] Loading remote materials...');
            const remote = await materialService.loadDailySparkMaterials();

            if (remote && remote.length > 0) {
                setAllMaterials(prev => {
                    const merged = materialService.mergeMaterials(prev, remote);
                    console.log(`✅ [Daily Spark] Material pool expanded: ${prev.length} → ${merged.length}`);
                    return merged;
                });
            }
        } catch (e) {
            console.warn('[Daily Spark] Failed to load remote materials, using bundled only:', e);
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
            console.log(`✅ [Daily Spark] Marked ${materialId} as read`);
        } catch (e) {
            console.error('[Daily Spark] Failed to save read history:', e);
        }
    };

    return {
        material,
        isLoading: isLoadingHistory, // 只有首次加载历史时才loading
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
