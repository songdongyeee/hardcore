import { useState, useEffect, useRef } from "react";
import { Library, Sparkles, Menu, Upload, Filter, BookOpen, X, Star, RefreshCw } from 'lucide-react';
import { Dialog } from '@capacitor/dialog';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App as CapacitorApp } from '@capacitor/app';
import { MaterialCard } from "@/components/MaterialCard";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { Paywall } from "@/components/Paywall";
import { pickAudioFile } from "@/utils/fileHandler";
import { audioConverter } from "@/services/audioConverter";
import { cn } from "@/lib/utils";
import { materialService } from "@/lib/materialService";
import { UploadModal } from "@/components/UploadModal";
import { pb, updateUserProgress, fetchUserProgress, silentLogin } from "@/lib/api";
import type { Material } from "@/data/types";
import type { TranscriptSegment } from "@/data/transcript";



// Helper function to calculate next quota reset date based on subscription tier
// Calculate next reset date based on user's subscription cycle, not natural month/year
const calculateNextResetDate = (
  tier: 'monthly' | 'quarterly' | 'yearly',
  currentResetDate: string  // User's current quota_reset_date
): string => {
  const baseDate = new Date(currentResetDate);
  let nextReset = new Date(baseDate);

  switch (tier) {
    case 'monthly':
      nextReset.setMonth(nextReset.getMonth() + 1);  // Add 1 month from current reset date
      break;
    case 'quarterly':
      nextReset.setMonth(nextReset.getMonth() + 3);  // Add 3 months from current reset date
      break;
    case 'yearly':
      nextReset.setFullYear(nextReset.getFullYear() + 1);  // Add 1 year from current reset date
      break;
  }

  return nextReset.toISOString();
};

interface HomeViewProps {
  onPlay: (audioUrl: string, targetView?: 'listening' | 'shadowing', transcript?: TranscriptSegment[], materialId?: string, waveformData?: number[][], title?: string) => void;
  onProfile: () => void;
  isActive?: boolean;
  isAuthCheckComplete: boolean; // 🛡️ Strict Auth Gate
}


export function HomeView({ onPlay, onProfile, isActive, isAuthCheckComplete }: HomeViewProps) {
  // Removed unused activeId state
  const [showPaywall, setShowPaywall] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'initial' | 'progress' | 'success' | 'error'>('initial');
  const [importProgress, setImportProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [progressMessage, setProgressMessage] = useState('');

  // Refactored Filter State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'starred' | 'reading'>('all');

  // Instant Render: Initialize with bundled materials immediately
  const [allMaterials, setAllMaterials] = useState<Material[]>(() => materialService.getBundledOnly());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [usedSeconds, setUsedSeconds] = useState(0);
  const [pbSubscriptionTier, setPbSubscriptionTier] = useState<'free' | 'monthly' | 'quarterly' | 'yearly'>('free');

  // 🎯 存储今天选中的Daily Spark ID（用于精确匹配）
  const [selectedDailySparkId, setSelectedDailySparkId] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Network failure state - for manual retry UI
  const [loadFailed, setLoadFailed] = useState(false);

  // 🎯 Track whether we've successfully loaded remote data (not just bundled materials)
  const hasLoadedRemoteDataRef = useRef(false);
  const isRecoveringRef = useRef(false); // 🔒 Mutex lock for network recovery
  const hasInitializedRef = useRef(false); // 🎯 Ensure initData runs only once

  const { isVip } = useRevenueCat();
  const { } = useUsageLimit(isVip);

  // Use PocketBase tier for stable display (RevenueCat tier is unstable in sandbox)
  const subscriptionTier = pbSubscriptionTier;

  const loadData = async () => {
    const data = await materialService.loadAllMaterials();
    setAllMaterials(data);
  };

  // 🎯 缓存加载标志位 - 用于区分首次安装和重开应用
  const hasCacheLoadedRef = useRef(false);

  useEffect(() => {
    const initData = async () => {
      // 🚀 阶段 1: 尝试加载缓存（不等待 Auth）
      if (!hasCacheLoadedRef.current) {
        const snapshot = await materialService.getCachedSnapshot();
        if (snapshot && snapshot.length > 0) {
          hasCacheLoadedRef.current = true;
          console.log('✅ [Fast Path] Cache loaded, bypassing Auth Gate');

          // 合并缓存（不覆盖 bundled）
          setAllMaterials(prev => materialService.mergeMaterials(prev, snapshot));
          setIsInitialLoading(false); // 立即关闭骨架屏
        }
      }

      // 🎯 阶段 2: 根据缓存情况选择加载路径
      if (hasCacheLoadedRef.current) {
        // ========== 路径 B: 有缓存 (重开应用) ==========
        // 等 Auth 后直接加载远程数据（静默更新）
        if (!isAuthCheckComplete) return;
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        console.log('🔄 [Fast Path] Loading remote data in background...');
        loadRemoteDataInBackground();
      } else {
        // ========== 路径 A: 无缓存 (首次安装) ==========
        // 🛡️ Strict Auth Gate: Block execution until auth check is complete
        if (!isAuthCheckComplete) {
          console.log('🛡️ [First Install] Blocked by Auth Gate: Waiting for auth check...');
          return;
        }

        // 🔒 Prevent multiple concurrent executions
        if (hasInitializedRef.current) {
          console.log('🔒 initData already running/completed, skipping...');
          return;
        }
        hasInitializedRef.current = true;

        console.log('🎬 [First Install] Starting original init sequence...');

        // 1. 立即显示 bundled 材料
        const bundled = materialService.getBundledOnly();
        setAllMaterials(bundled);

        // 2. 尝试显示缓存（理论上不会走到这里，因为前面已经检查过了）
        const snapshot = await materialService.getCachedSnapshot();
        if (snapshot && snapshot.length > 0) {
          setAllMaterials(prev => materialService.mergeMaterials(prev, snapshot));
        }

        // ✅ 根据是否有内容决定何时结束loading
        const hasContent = bundled.length > 0 || (snapshot && snapshot.length > 0);
        if (hasContent) {
          setIsInitialLoading(false);
        }
        // 如果没有内容，保持loading直到远程数据到达

        // 🔄 后台快速加载远程数据
        loadRemoteDataInBackground();
      }
    };

    // 新函数：后台快速加载（并行 + 共享缓存）
    const loadRemoteDataInBackground = async () => {
      try {
        // ⚡ 优化1：只获取1次用户进度（避免重复请求）
        const progressList = await fetchUserProgress();

        // ⚡ 优化2：并行加载Daily Spark和Core Library（节省500ms）
        const [dailySparkItems, coreLibResult] = await Promise.all([
          materialService.loadDailySparkMaterials(progressList),
          materialService.loadMaterialsPage(1, 20, progressList)
        ]);

        console.log('🔍 [Debug] Daily Spark items:', dailySparkItems.length);
        console.log('🔍 [Debug] Core Library items:', coreLibResult.items.length);
        console.log('🔍 [Debug] Core Library result:', coreLibResult);

        // 🔥 一次性更新Daily Spark和Core Library，避免中间状态
        setAllMaterials(prev => {
          console.log('🔍 [Debug] Previous materials:', prev.length);

          // 🎯 原子性更新：直接构建最终状态（避免闪现）
          const final = [
            // 1. 保留非 Daily Spark 的材料
            ...prev.filter(m => m.location !== 'daily_spark'),
            // 2. 添加新的 Daily Spark
            ...dailySparkItems,
            // 3. 合并 Core Library（去重）
            ...coreLibResult.items.filter(item =>
              !prev.some(p => p.id === item.id) && // 不在旧数据里
              !dailySparkItems.some(d => d.id === item.id) // 也不在 Daily Spark 里
            )
          ];

          console.log('🔍 [Debug] Final materials count:', final.length);

          // 🔥 CRITICAL: 保存快照到缓存（下次启动用）
          materialService.saveSnapshot(final);

          return final;
        });

        // 保存今天选中的Daily Spark ID
        if (dailySparkItems.length > 0) {
          const { value: cachedId } = await Preferences.get({ key: 'daily_spark_id' });
          setSelectedDailySparkId(cachedId);
        }
        setHasMorePages(coreLibResult.hasMore);
        setCurrentPage(1);

        // ✅ 只有当确实加载到了数据时，才结束Loading并标记为已加载
        // 如果数据为空，可能是网络不稳定导致的部分失败，保持Loading等待Network Listener重试
        if (coreLibResult.items.length > 0 || dailySparkItems.length > 0) {
          setIsInitialLoading(false);
          hasLoadedRemoteDataRef.current = true; // 🎯 Critical: prevent network listener from triggering redundant recovery
        } else {
          console.warn('⚠️ Initial load returned empty data, maintaining loading state');
        }

        // 后台预缓存封面
        setTimeout(() => prefetchCovers(coreLibResult.items, 20), 2000);

      } catch (error) {
        console.error('Failed to load remote data:', error);
        // ⚠️ 不要立即显示"加载失败"，保持loading状态
        // 原因：用户可能还在"允许网络"弹窗上，还没做决定
        // 网络监听器会在授权后自动触发重试
        // 只记录日志，不改变UI状态
      }
    };

    initData();

    // 🕐 超时检查：30秒后如果还在loading且没有材料，显示重试按钮
    // 🛡️ Strict Auth Gate: Only start timer if auth check is complete
    let timeoutId: any;
    if (isAuthCheckComplete) {
      timeoutId = setTimeout(() => {
        if (isInitialLoading && allMaterials.length === 0) {
          console.warn('⏱️ Loading timeout after 30s, showing retry button');
          setLoadFailed(true);
          setIsInitialLoading(false);
        }
      }, 30000);
    }

    return () => clearTimeout(timeoutId);
  }, [pb.authStore.isValid, isAuthCheckComplete]); // Add isAuthCheckComplete dep

  // 🎯 Event-Driven Network Recovery: Listen for network status changes and app state changes
  // 🎯 Event-Driven Network Recovery: Listen for network status changes and app state changes
  useEffect(() => {
    let networkListener: any;
    let appStateListener: any;
    let debounceTimer: any = null;

    const handleNetworkRecovery = async () => {
      // 🔒 Prevent overlapping recovery attempts (check and set atomically)
      if (isRecoveringRef.current) {
        console.warn('🔒 Recovery already in progress, skipping...');
        return;
      }
      isRecoveringRef.current = true; // Set lock BEFORE any await

      console.log('📡 Network status changed, attempting to reload data...');
      setLoadFailed(false);

      // Re-authenticate if needed
      if (!pb.authStore.isValid) {
        // Double check validity inside the lock (in case another thread fixed it)
        if (!pb.authStore.isValid) {
          const { Device } = await import('@capacitor/device');
          const deviceId = await Device.getId();
          const success = await silentLogin(deviceId.identifier);
          if (!success) {
            console.warn('Re-authentication failed');
            isRecoveringRef.current = false; // Release lock
            return;
          }
        }
      }

      // 🔄 Reload data with single automatic retry (production-grade approach)
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`📡 Network recovery attempt ${attempt}/2...`);
          const progressList = await fetchUserProgress();
          const [dailySparkItems, coreLibResult] = await Promise.all([
            materialService.loadDailySparkMaterials(progressList),
            materialService.loadMaterialsPage(1, 20, progressList)
          ]);

          // ✅ Success - update UI
          if (coreLibResult.items.length === 0) {
            console.warn('⚠️ Core library empty after reload, marking as partial failure');
            setLoadFailed(true);
          }

          setAllMaterials(prev => {
            const withoutDailySpark = prev.filter(m => m.location !== 'daily_spark');
            const withDailySpark = dailySparkItems.length > 0
              ? materialService.mergeMaterials(withoutDailySpark, dailySparkItems)
              : withoutDailySpark;
            return materialService.mergeMaterials(withDailySpark, coreLibResult.items);
          });

          if (dailySparkItems.length > 0) {
            const { value: cachedId } = await Preferences.get({ key: 'daily_spark_id' });
            setSelectedDailySparkId(cachedId);
          }
          setHasMorePages(coreLibResult.hasMore);
          setCurrentPage(1);
          hasLoadedRemoteDataRef.current = true; // 🎯 Mark remote data as successfully loaded

          console.log(`✅ Network recovery successful on attempt ${attempt}`);
          isRecoveringRef.current = false;
          return; // Success - exit early

        } catch (error) {
          lastError = error;
          console.warn(`⚠️ Network recovery attempt ${attempt}/2 failed:`, error);

          if (attempt === 1) {
            // First attempt failed, wait 1s before retry
            console.log('⏳ Waiting 1s before retry...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Both attempts failed - show error
      console.error('❌ Network recovery failed after 2 attempts:', lastError);
      setLoadFailed(true);
      isRecoveringRef.current = false;
    };

    const setupListeners = async () => {
      // Listen for network status changes
      networkListener = await Network.addListener('networkStatusChange', status => {
        // Trigger reload if: network connected AND (not authenticated OR failed to load OR no remote data yet)
        const shouldReload = status.connected && (!pb.authStore.isValid || loadFailed || !hasLoadedRemoteDataRef.current);
        if (shouldReload) {
          // ⏳ Debounce: Wait 200ms for network to stabilize and coalesce events
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log('📡 Network connected (debounced), triggering reload...');
            handleNetworkRecovery();
          }, 200); // Reduced from 500ms to 200ms
        }
      });

      // Listen for app returning to foreground
      appStateListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        // Trigger reload if: app became active AND (not authenticated OR failed to load OR no remote data yet)
        const shouldReload = isActive && (!pb.authStore.isValid || loadFailed || !hasLoadedRemoteDataRef.current);
        if (shouldReload) {
          // ⏳ Debounce: Wait 200ms
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log('🔄 App became active (debounced), triggering reload...');
            handleNetworkRecovery();
          }, 200); // Reduced from 500ms to 200ms
        }
      });
    };

    setupListeners();

    return () => {
      networkListener?.remove();
      appStateListener?.remove();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []); // ⚠️ Empty dependencies: listeners should only be set once on mount

  // Removed: isActive refresh - causes unnecessary reloads

  // Separate effect for fetching user profile allows it to run whenever subscription status changes
  useEffect(() => {
    if (!pb.authStore.isValid || !pb.authStore.model?.id) return;

    const fetchUserProfile = async () => {
      try {
        // Add a small delay to allow useRevenueCat's sync to complete first
        await new Promise(r => setTimeout(r, 1000));

        const user = await pb.collection('users').getOne(pb.authStore.model!.id);
        const tier = user.subscription_tier || 'free';
        const used = user.used_seconds || 0;

        // Update global auth store so other components (like ProfileView) see the update immediately
        pb.authStore.save(pb.authStore.token, user);

        setPbSubscriptionTier(tier);
        setUsedSeconds(used);
        console.log('[HomeView] Refreshed user profile & AuthStore. Tier:', tier, 'Used:', used);
      } catch (e) {
        console.warn('Failed to refresh user profile:', e);
      }
    };

    fetchUserProfile();

    // ✅ Also listen for visibility changes to refresh when user returns from other views
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[HomeView] Page became visible, refreshing subscription status...');
        fetchUserProfile();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pb.authStore.isValid, isVip]); // Re-run when VIP status changes (e.g. after purchase)

  // ✅ Refresh subscription status when HomeView becomes active again (e.g., returning from ProfileView)
  useEffect(() => {
    if (!isActive || !pb.authStore.isValid || !pb.authStore.model?.id) return;

    const refreshOnActivation = async () => {
      try {
        console.log('[HomeView] View activated, refreshing subscription status...');
        const user = await pb.collection('users').getOne(pb.authStore.model!.id);
        const tier = user.subscription_tier || 'free';
        const used = user.used_seconds || 0;

        pb.authStore.save(pb.authStore.token, user);
        setPbSubscriptionTier(tier);
        setUsedSeconds(used);
        console.log('[HomeView] Subscription refreshed on activation. Tier:', tier);
      } catch (e) {
        console.warn('Failed to refresh on activation:', e);
      }
    };

    refreshOnActivation();
  }, [isActive]); // Refresh when HomeView becomes active

  // Common Sort Function
  const sortMaterials = (a: Material, b: Material) => {
    const aPinned = a.userMeta?.isPinned ? 1 : 0;
    const bPinned = b.userMeta?.isPinned ? 1 : 0;

    // 1. Priority: Pinned status
    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }

    // 2. Tie-breaker for pinned: Newest pinned first
    if (aPinned && bPinned) {
      const timeA = new Date(a.userMeta?.updatedAt || 0).getTime();
      const timeB = new Date(b.userMeta?.updatedAt || 0).getTime();
      return timeB - timeA;
    }

    // 3. Normal items: Newest created first
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  };

  // Derived Categorized Lists (Now Sorted!)
  // 🎯 Daily Spark: loadDailySparkMaterials已经返回了今天选中的材料
  // 重要：不使用筛选逻辑，不受activeFilter影响
  const dailySparkMaterials = allMaterials
    .filter((m: Material) => m.location === 'daily_spark');

  // 🎯 精确匹配今天缓存的selectedId，避免显示错误的Daily Spark
  const activeDailyMaterial = selectedDailySparkId
    ? dailySparkMaterials.find(m => m.id === selectedDailySparkId) || dailySparkMaterials[0] || null
    : dailySparkMaterials[0] || null;

  const coreLibraryMaterials = allMaterials.filter((m: Material) => m.location === 'core_library');



  // Filter Logic for Core Library
  const displayMaterials = coreLibraryMaterials
    .filter((m: Material) => {
      if (activeFilter === 'starred') return m.userMeta?.isStarred;
      if (activeFilter === 'reading') return (m.userMeta?.currentStep || 0) > 0 && (m.userMeta?.currentStep || 0) < 4;
      return true;
    })
    .sort(sortMaterials);


  const handleToggleStar = async (materialId: string, currentState: boolean) => {
    try {
      await updateUserProgress(materialId, { is_starred: !currentState });
      // Update local state for immediate feedback
      setAllMaterials((prev: Material[]) => {
        const updated = prev.map((m: Material) =>
          m.id === materialId
            ? { ...m, userMeta: m.userMeta ? { ...m.userMeta, isStarred: !currentState } : { isStarred: !currentState, currentStep: 0, isOffline: false } }
            : m
        );
        // 🧠 Sync snapshot immediately so we don't flash old state on navigation return
        materialService.updateCachedSnapshot(updated);
        return updated;
      });
    } catch (e: any) {
      console.error("Failed to toggle star", e);
    }
  };

  // 加载更多（分页）
  const loadMore = async () => {
    if (!hasMorePages || isLoadingMore) return;

    setIsLoadingMore(true);
    const nextPage = currentPage + 1;

    try {
      const { items, hasMore } = await materialService.loadMaterialsPage(nextPage, 20);
      setAllMaterials(prev => materialService.mergeMaterials(prev, items));
      setHasMorePages(hasMore);
      setCurrentPage(nextPage);

      // 后台缓存新加载的封面
      setTimeout(() => prefetchCovers(items, 20), 1000);
    } catch (error) {
      console.error('Failed to load more:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // 封面图预缓存
  const prefetchCovers = async (materials: Material[], count: number = 20) => {
    try {
      await materialService.prefetchCovers(materials, count);

      // 更新状态，标记为已缓存
      setAllMaterials(prev => prev.map(m => {
        const cached = materials.find(mat => mat.id === m.id);
        if (cached) {
          return {
            ...m,
            userMeta: { ...m.userMeta!, isOffline: true }
          };
        }
        return m;
      }));
    } catch (error) {
      console.warn('Prefetch failed:', error);
    }
  };

  // 滚动监听
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

    // 距离底部 300px 时触发加载
    if (scrollHeight - scrollTop - clientHeight < 300) {
      loadMore();
    }
  };


  const handleTogglePin = async (materialId: string, currentState: boolean) => {
    // 1. Check if user is authenticated
    if (!pb.authStore.isValid || !pb.authStore.model?.id) {
      setShowPaywall(true);
      return;
    }
    try {
      await updateUserProgress(materialId, { is_pinned: !currentState });
      // Update local state for immediate feedback
      setAllMaterials((prev: Material[]) => {
        const updated = prev.map((m: Material) =>
          m.id === materialId
            ? { ...m, userMeta: m.userMeta ? { ...m.userMeta, isPinned: !currentState } : { isPinned: !currentState, isStarred: false, currentStep: 0, isOffline: false, updatedAt: new Date().toISOString() } }
            : m
        );
        // 🧠 Sync snapshot immediately
        materialService.updateCachedSnapshot(updated);
        return updated;
      });
    } catch (e: any) {
      console.error("Failed to toggle pin", e);
    }
  };


  const handleCardClick = async (material: Material) => {
    // 1. Check if user is authenticated
    if (!pb.authStore.isValid || !pb.authStore.model?.id) {
      setShowPaywall(true);
      return;
    }

    // 2. Free user material access limit
    // Applies to Bundled materials AND Remote Public materials
    const isPublicContent = material.source === 'bundled' || material.visibility === 'public' || material.id.includes('bundled');

    console.log(`[Free Limit] Material: ${material.id}, isPublicContent: ${isPublicContent}, location: ${material.location}`);
    if (isPublicContent) {
      try {
        const user = await pb.collection('users').getOne(pb.authStore.model.id);
        const subscriptionTier = user.subscription_tier || 'free';
        const currentCount = user.materials_read_count || 0;

        console.log(`[Free Limit] User tier: ${subscriptionTier}, current count: ${currentCount}/3`);

        // Only apply limit for free users
        if (subscriptionTier === 'free') {
          // Check if this material has a progress record (means it was accessed before)
          try {
            await pb.collection('user_progress').getFirstListItem(
              `user="${pb.authStore.model.id}" && material_id="${material.id}"`
            );
            // Material was accessed before, Allow access
            console.log(`[Free Limit] ✅ Material ${material.id} was accessed before, allowing access`);
          } catch (notFoundErr) {
            // No progress record found, this is first access
            // CHECK LIMIT (计数会在App.tsx的handlePlay中自动处理)
            console.log(`[Free Limit] 🆕 First time accessing ${material.id}, checking limit...`);

            if (currentCount >= 3) {
              console.log(`[Free Limit] ❌ BLOCKED! Count ${currentCount} >= 3, showing paywall`);
              setShowPaywall(true);
              return;
            }

            // ✅ 允许访问（计数会在App.tsx的handlePlay中自动处理）
            console.log(`[Free Limit] ✅ ALLOWED! (count will auto-increment in handlePlay)`);
          }
        }
      } catch (e) {
        console.warn('Failed to check material access limit:', e);
      }
    }

    // 3. 🔒 CRITICAL: Force local file check before playing to avoid server requests
    let finalAudioUrl = material.audioUrl;
    // Removed unused finalCoverUrl

    // If URL is a server URL (not local), check if local file exists
    if (!finalAudioUrl.startsWith('capacitor://') && !finalAudioUrl.startsWith('blob:')) {
      const localAudio = await materialService.checkLocalFile(material.id, 'audio');
      if (localAudio) {
        finalAudioUrl = localAudio;
        // Update state to prevent future server requests
        setAllMaterials(prev => prev.map(m =>
          m.id === material.id ? { ...m, audioUrl: localAudio, userMeta: { ...m.userMeta!, isOffline: true } } : m
        ));
      } else if (material.userMeta && !material.userMeta.isOffline) {
        // Download in background if not cached
        materialService.downloadMaterial(material.id, material.audioUrl, material.coverUrl).then(localPath => {
          if (localPath) {
            console.log("Material cached during playback:", material.id);
            setAllMaterials(prev => prev.map(m =>
              m.id === material.id ? { ...m, audioUrl: localPath, userMeta: { ...m.userMeta!, isOffline: true } } : m
            ));
          }
        });
      }
    }

    // 3. Play with LOCAL URL
    console.log('[HomeView] Playing material:', material.id);
    console.log('[HomeView] Waveform data:', material.waveform_data);
    onPlay(finalAudioUrl, 'listening', material.transcript, material.id, material.waveform_data, material.title); // Pass material.title
  };

  const handleImportClick = () => {
    setShowUploadModal(true);
  };

  const handleStartImport = async (language: string) => {
    try {
      const file = await pickAudioFile();
      if (!file) return;

      setImportFileName(file.name);
      processImport(file, language);
    } catch (e: any) {
      console.error("File picker error", e);
      alert("文件选择失败");
    }
  };

  const processImport = async (file: any, language: string) => {
    if (uploadStatus === 'progress') return;
    setUploadStatus('progress');
    setErrorMessage('');

    // Track temp file for cleanup
    let tempFileToDelete: string | null = null;

    try {
      setImportProgress(5);

      // 2. Format Check
      const ALLOWED_FORMATS = /\.(mp3|m4a|wav|aac|ogg|flac|mp4|mov|avi|m4v|mkv|webm)$/i;
      if (!ALLOWED_FORMATS.test(file.name)) {
        setErrorMessage("不支持的格式！支持 MP3, M4A, WAV, AAC, OGG, FLAC, MP4, MOV, AVI, M4V, MKV, WEBM");
        setUploadStatus('error');
        return;
      }

      // 3. System Duration Limit (Max 30 minutes for all users)
      // Note: Free users will be clipped to remainingQuota before upload
      setImportProgress(0);

      let finalUri = file.uri;
      let finalWebPath = file.webPath;

      const getDurationInfo = async (audioPath: string): Promise<{ durationStr: string; totalSeconds: number; ok: boolean }> => {
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const response = await fetch(audioPath);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const totalSeconds = Math.floor(audioBuffer.duration);

          if (totalSeconds > 1800) { // 30 minutes system limit
            return { durationStr: "00:00", totalSeconds, ok: false };
          }

          const mins = Math.floor(totalSeconds / 60);
          const secs = totalSeconds % 60;
          const durationStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

          return { durationStr, totalSeconds, ok: true };
        } catch (e: any) {
          console.warn("Duration extraction failed", e);
          return { durationStr: "00:00", totalSeconds: 0, ok: true }; // Fallback
        }
      };

      // 1. Process Media (Extract/Clip) (0-40%)
      const isVideo = file.name.match(/\.(mp4|mov|avi|m4v|mkv|webm)$/i);

      // 🎯 Tiered Membership Quota System
      // Fetch user's subscription info
      let subscriptionTier: 'free' | 'monthly' | 'quarterly' | 'yearly' = 'free';
      let quotaUsedSeconds = 0;
      let quotaResetDate: string | null = null;

      if (pb.authStore.isValid && pb.authStore.model?.id) {
        try {
          const user = await pb.collection('users').getOne(pb.authStore.model!.id);
          subscriptionTier = user.subscription_tier || 'free';
          quotaUsedSeconds = user.used_seconds || 0;
          quotaResetDate = user.quota_reset_date;

          // Check if quota needs reset (for paid tiers only)
          if (subscriptionTier !== 'free' && quotaResetDate && new Date(quotaResetDate) < new Date()) {
            // Reset quota - calculate next reset based on user's subscription cycle
            const nextResetDate = calculateNextResetDate(subscriptionTier, quotaResetDate);
            await pb.collection('users').update(pb.authStore.model.id, {
              used_seconds: 0,
              quota_reset_date: nextResetDate
            });
            quotaUsedSeconds = 0;
            console.log(`Quota reset for ${subscriptionTier} tier. Next reset: ${nextResetDate}`);
          }
        } catch (e) {
          console.warn('Failed to fetch user subscription info:', e);
        }
      }

      // Tiered file size limits based on subscription
      const FILE_SIZE_LIMITS = {
        free: 50 * 1024 * 1024,      // 50MB
        monthly: 500 * 1024 * 1024,  // 500MB
        quarterly: 1024 * 1024 * 1024, // 1GB
        yearly: 2 * 1024 * 1024 * 1024  // 2GB (Soft limit)
      };

      const maxFileSize = FILE_SIZE_LIMITS[subscriptionTier];
      const fileSizeMB = Math.round(file.size / (1024 * 1024));

      // Hard limit check (except yearly)
      if (file.size > maxFileSize) {
        const limitMB = Math.round(maxFileSize / (1024 * 1024));
        setErrorMessage(`文件大小 ${fileSizeMB}MB 超过${subscriptionTier === 'free' ? '免费用户' : '您的套餐'}限制（${limitMB}MB）`);
        setUploadStatus('error');
        return;
      }

      // Soft warning for yearly users with files > 2GB
      if (subscriptionTier === 'yearly' && file.size > 2 * 1024 * 1024 * 1024) {
        setErrorMessage(`文件过大（${fileSizeMB}MB），等待时间过长，建议拆分上传`);
        setUploadStatus('error');
        return;
      }

      // Calculate quota limits based on tier
      const QUOTA_MAP: Record<typeof subscriptionTier, number> = {
        free: 60,           // 60 seconds lifetime
        monthly: 1800,      // 30 minutes per month
        quarterly: 10800,   // 180 minutes per quarter
        yearly: 72000       // 1200 minutes per year
      };

      const totalQuota = QUOTA_MAP[subscriptionTier];
      const remainingQuota = Math.max(0, totalQuota - quotaUsedSeconds);

      // If quota exhausted, show paywall
      if (remainingQuota <= 0) {
        setErrorMessage(subscriptionTier === 'free'
          ? "免费额度已用完，请升级会员解锁更多额度"
          : "本周期额度已用完，请等待下次重置或升级套餐");
        setUploadStatus('error');
        setShowPaywall(true);
        return;
      }

      // Dynamic clipping limit
      const limitSeconds = remainingQuota;

      if (isVideo) {
        console.log("Video detected, starting conversion...");
        setProgressMessage('正在提取音频...');
        finalUri = await audioConverter.extractAudio(file.webPath, file.name, (p: number) => {
          setImportProgress(Math.round(p * 30)); // Stage 1: 0-30%
        }, limitSeconds);

        const tempFileName = finalUri.split('/').pop();
        if (tempFileName) tempFileToDelete = tempFileName;

        const { Capacitor } = await import('@capacitor/core');
        finalWebPath = Capacitor.convertFileSrc(finalUri);
      } else if (!isVip) {
        // For audio files, we check duration first to see if we need to clip
        setImportProgress(5);
        const durationInfo = await getDurationInfo(finalWebPath);

        // If it's a long audio and user is not VIP, clip it!
        if (durationInfo.totalSeconds > limitSeconds) {
          console.log(`Long audio detected, clipping to ${limitSeconds}s...`);
          setProgressMessage('正在提取音频...');
          finalUri = await audioConverter.clipAudio(file.webPath, limitSeconds, (p: number) => {
            setImportProgress(5 + Math.round(p * 25)); // Stage 1: 5-30%
          });

          const tempFileName = finalUri.split('/').pop();
          if (tempFileName) tempFileToDelete = tempFileName;

          const { Capacitor } = await import('@capacitor/core');
          finalWebPath = Capacitor.convertFileSrc(finalUri);
        } else {
          setImportProgress(30); // Stage 1 complete
        }
      } else {
        setImportProgress(30); // Stage 1 complete
      }

      // 2. Extract Duration & Prompt for Topic (40-50%)
      // The definition of getDurationInfo was here, moved above.

      const durationInfo = await getDurationInfo(finalWebPath);
      if (!durationInfo.ok) {
        setErrorMessage("音频最大支持 30 分钟");
        setUploadStatus('error');
        setImportProgress(0);
        return;
      }

      const finalTopic = "General";

      // Stage 1 complete, begin Stage 2: Network Upload (30% → 70%)
      setImportProgress(30);
      setProgressMessage('正在上传文件...');

      // 3. Prepare Blob & FileName
      const audioResponse = await fetch(finalWebPath);
      const blob = await audioResponse.blob();

      // Determine extension: 'm4a' for video/clip extraction, or original extension
      let ext = 'mp3';
      if (finalUri !== file.uri) {
        ext = 'm4a';
      } else {
        const parts = file.name.split('.');
        if (parts.length > 1) {
          ext = parts.pop()!.toLowerCase();
        }
      }

      const fileName = `upload_${Date.now()}.${ext}`;

      // Estimate upload time based on file size (5-30 seconds)
      const estimatedUploadTime = Math.max(5, Math.min(30, blob.size / 200000));

      // Stage 2: Simulated upload progress (30% → 70%)
      let uploadProgress = 30;
      const uploadInterval = setInterval(() => {
        if (uploadProgress < 70) {
          uploadProgress += 1;
          setImportProgress(uploadProgress);
        }
      }, (estimatedUploadTime * 1000) / 40); // Spread 40 points over estimated time

      // 4. Upload to PB transcripts collection
      const formData = new FormData();
      formData.append('audio', blob, fileName);
      formData.append('location', 'core_library');
      formData.append('visibility', 'private');
      formData.append('duration', durationInfo.durationStr);
      formData.append('topic', finalTopic);
      formData.append('language', language);

      if (pb.authStore.isValid && pb.authStore.model?.id) {
        formData.append('owner', pb.authStore.model.id);
      }
      formData.append('status', 'processing');

      // Execute upload (removed onProgress as it's unreliable)
      const record = await pb.collection('transcripts').create(formData);

      // Upload complete! Stop simulation and jump to 70%
      clearInterval(uploadInterval);
      setImportProgress(70);
      setProgressMessage('正在转写... 转写由千问付费提供');

      // Stage 3: Backend processing (70% → 100%)
      // Aliyun ASR is fast: actual time ~15% of audio duration
      const estimatedBackendTime = Math.round(durationInfo.totalSeconds * 0.15);

      let backendProgress = 70;
      // Cap interval: min 500ms, max 2000ms for smooth updates
      const backendIntervalTime = Math.max(500, Math.min(2000, (estimatedBackendTime * 1000) / 30));
      const backendInterval = setInterval(() => {
        if (backendProgress < 95) {
          // 70% → 95%: Normal speed
          backendProgress += 1;
          setImportProgress(backendProgress);
        } else if (backendProgress < 99) {
          // 95% → 99%: Slower (still use same interval, just less frequent updates)
          if (Math.random() < 0.3) { // Only update 30% of the time
            backendProgress += 1;
            setImportProgress(backendProgress);
          }
        }
        // Stop at 99%, wait for real completion
      }, backendIntervalTime);

      // Poll for backend completion
      let attempts = 0;
      const maxAttempts = 150; // Max 5 minutes (150 * 2s)

      // Show warning after 2 minutes
      const warningTimer = setTimeout(() => {
        setProgressMessage('文件较大，预计需要3-5分钟转写');
      }, 120000); // 2 minutes


      console.log('[POLLING INIT] Starting backend status polling for record:', record.id);
      console.log('[POLLING INIT] Will check every 500ms, max', maxAttempts, 'attempts (75 seconds)');

      const checkInterval = setInterval(async () => {
        attempts++;

        try {
          const updated = await pb.collection('transcripts').getOne(record.id);

          // Debug logging
          console.log(`[Polling ${attempts}] Record status:`, updated.status, 'Full record:', updated);

          // Backend uses 'done' status, not 'completed'
          if (updated.status === 'done' || updated.status === 'completed') {
            console.log('[SUCCESS] Backend completed! Cleaning up intervals...');
            // Backend complete! Stop simulation and jump to 100%
            clearInterval(backendInterval);
            clearInterval(checkInterval);
            clearTimeout(warningTimer);
            setImportProgress(100);

            // OPTIMIZATION: Cache imported file locally to avoid re-downloading
            if (tempFileToDelete) {
              try {
                // 1. Ensure 'media' directory exists
                await Filesystem.mkdir({
                  path: 'media',
                  directory: Directory.Documents,
                  recursive: true
                }).catch(() => { });

                const cacheFileName = `media/${record.id}.m4a`;
                console.log(`[File Cache] Copying: ${tempFileToDelete} -> ${cacheFileName}`);

                // 2. Read temporary file content
                const tempContent = await Filesystem.readFile({
                  path: tempFileToDelete
                });

                // 3. Write to cache directory
                await Filesystem.writeFile({
                  path: cacheFileName,
                  directory: Directory.Documents,
                  data: tempContent.data,
                  recursive: true
                });

                // 4. Verify file was written successfully
                const verifyResult = await Filesystem.stat({
                  path: cacheFileName,
                  directory: Directory.Documents
                });

                console.log(`✅ [File Cache] Success: ${cacheFileName} (${verifyResult.size} bytes)`);

                // 5. Mark as cached (prevent deletion in finally block)
                tempFileToDelete = null;
              } catch (cacheErr) {
                console.error("❌ [File Cache] Failed:", cacheErr);
                // tempFileToDelete remains non-null and will be cleaned up in finally
              }
            }

            setImportProgress(100);

            // 🎯 Update user quota for all users
            if (pb.authStore.isValid && pb.authStore.model?.id) {
              try {
                // Use the original durationInfo that was calculated earlier
                const actualSeconds = Math.round(durationInfo.totalSeconds);

                // Update user's used_seconds atomically
                await pb.collection('users').update(pb.authStore.model.id, {
                  "used_seconds+": actualSeconds
                });

                // Refresh local state
                setUsedSeconds(prev => prev + actualSeconds);

                console.log(`Quota updated: +${actualSeconds}s (${subscriptionTier} user)`);
              } catch (quotaErr) {
                console.error('Failed to update quota:', quotaErr);
                // Non-blocking, don't interrupt upload success
              }
            }

            // Small delay to let user see 100%
            // 5. Success UI Handled by Modal (60-100%)

            // ⚡ OPTIMISTIC UPDATE: Insert new material immediately without waiting for API refresh
            try {
              // Get verified local audio URL
              const localAudioPath = await materialService.checkLocalFile(record.id, 'audio');

              if (localAudioPath) {
                const newMaterial: Material = {
                  id: record.id,
                  source: 'remote',
                  location: 'core_library',
                  title: finalTopic || updated.title || 'Untitled',
                  title_translate: updated.title_translate,
                  subtitle: new Date().toLocaleDateString(),
                  audioUrl: localAudioPath,
                  coverUrl: '/images/default_cover.png',
                  transcript: materialService.parseTranscript(updated.transcription || updated.text || []),
                  visibility: updated.visibility || 'private',
                  createdAt: updated.created,
                  tags: {
                    topic: finalTopic || updated.topic || 'General',
                    difficulty: updated.difficulty || 'L1',
                    duration: durationInfo.durationStr
                  },
                  userMeta: {
                    isStarred: false,
                    isPinned: false,
                    currentStep: 0,
                    isOffline: true,
                    updatedAt: updated.created
                  },
                  isNew: true // 🎯 Trigger animation
                };

                console.log('✨ [Optimistic Update] Inserting new material:', newMaterial.id);

                // Insert to top of list
                setAllMaterials(prev => {
                  if (prev.some(m => m.id === newMaterial.id)) return prev;
                  return [newMaterial, ...prev];
                });

                // Remove isNew flag after animation completes
                setTimeout(() => {
                  setAllMaterials(prev => prev.map(m =>
                    m.id === newMaterial.id ? { ...m, isNew: false } : m
                  ));
                }, 3000); // 1.2s delay + 0.6s animation + buffer

                setUploadStatus('success');
              } else {
                throw new Error('Local file not ready, falling back to loadData');
              }
            } catch (optErr) {
              console.warn('Optimistic update failed:', optErr);
              // Fallback to traditional refresh
              setUploadStatus('success');
              loadData();
            }




          } else if (attempts > maxAttempts) {
            // Timeout after 5 minutes
            clearInterval(backendInterval);
            clearInterval(checkInterval);
            clearTimeout(warningTimer);
            throw new Error('处理超时，请稍后重试');
          }
        } catch (pollError: any) {
          if (attempts > maxAttempts) {
            clearInterval(backendInterval);
            clearInterval(checkInterval);
            clearTimeout(warningTimer);
            setErrorMessage('处理超时: ' + pollError.message);
            setUploadStatus('error');
          }
          // Otherwise continue polling
        }
      }, 500); // Check every 500ms for faster detection

    } catch (e: any) {
      console.error("Import/Convert failed", e);
      let errorMsg = e.message;
      if (e.originalError?.data?.data) {
        const details = Object.entries(e.originalError.data.data)
          .map(([key, val]: [string, any]) => `${key}: ${val.message}`)
          .join('\n');
        errorMsg = `Validation failed: ${details}`;
      } else if (e.originalError?.data?.message) {
        errorMsg = e.originalError.data.message;
      }
      setErrorMessage(errorMsg);
      setUploadStatus('error');
    } finally {
      // 🧹 Cleanup Temp File
      if (tempFileToDelete) {
        try {
          console.log("Cleaning up temp file:", tempFileToDelete);
          await Filesystem.deleteFile({
            path: tempFileToDelete,
            directory: Directory.Documents
          });
        } catch (cleanupErr) {
          console.warn("Failed to delete temp file:", cleanupErr);
        }
      }

      setImportProgress(0);
    }
  };


  const handleRename = async (materialId: string, currentTitle: string) => {
    const { value, cancelled } = await Dialog.prompt({
      title: '重命名材料',
      message: '请输入新的名称：',
      inputText: currentTitle,
      okButtonTitle: '确认',
      cancelButtonTitle: '取消',
    });

    if (!cancelled && value && value.trim()) {
      try {
        // 1. 更新服务器数据
        await pb.collection('transcripts').update(materialId, {
          title: value.trim()
        });

        // 2. 立即更新本地状态
        setAllMaterials(prev => {
          const updated = prev.map(m =>
            m.id === materialId ? { ...m, title: value.trim() } : m
          );
          // 3. 同步更新缓存快照
          materialService.updateCachedSnapshot(updated);
          return updated;
        });
      } catch (e: any) {
        alert("重命名失败: " + (e.message || '未知错误'));
      }
    }
  };

  const handleDelete = async (materialId: string) => {
    const { value } = await Dialog.confirm({
      title: '确认',
      message: '确认删除这个材料吗？',
      okButtonTitle: '确认删除',
      cancelButtonTitle: '不',
    });

    if (value) {
      try {
        // 1. 调用 API 删除
        await pb.collection('transcripts').delete(materialId);

        // 2. 清理本地文件
        await materialService.deleteLocalFiles(materialId);

        // 3. ✅ 立即从本地状态移除（不再使用 loadData()）
        setAllMaterials(prev => {
          const updated = prev.filter(m => m.id !== materialId);
          // 4. 同步更新缓存快照
          materialService.updateCachedSnapshot(updated);
          return updated;
        });
      } catch (e: any) {
        alert("删除失败: " + (e.message || '未知错误'));
      }
    }
  };

  return (
    <main
      className="flex-1 overflow-y-auto no-scrollbar scroll-smooth bg-black h-full"
      onScroll={handleScroll}
    >
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="pb-20">
        {/* Section 1: The Daily Spark */}
        {dailySparkMaterials.length > 0 && (
          <section className="px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] mb-1">
            <div className="flex gap-2 mb-4 items-center animate-in slide-in-from-bottom-4 duration-500">
              <Sparkles className="w-6 h-6 text-indigo-400" />
              <h2 className="text-3xl font-medium text-white tracking-tight">Daily Spark</h2>
              <button
                onClick={onProfile}
                className="ml-auto p-2 text-zinc-600 hover:text-white transition-colors"
                aria-label="Settings"
              >
                <Menu className="w-6 h-6" />
              </button>
            </div>

            {/* Unified Hero Card */}
            <div className="animate-in zoom-in-95 duration-700 delay-100 fill-mode-both">
              {activeDailyMaterial ? (
                <MaterialCard
                  material={activeDailyMaterial}
                  isActive={true}
                  variant="hero"
                  onClick={() => handleCardClick(activeDailyMaterial)}
                  onTogglePin={() => handleTogglePin(activeDailyMaterial.id, activeDailyMaterial.userMeta?.isPinned || false)}
                  onToggleStar={() => handleToggleStar(activeDailyMaterial.id, activeDailyMaterial.userMeta?.isStarred || false)}
                />
              ) : (
                <div className="aspect-[4/5] w-full rounded-2xl bg-zinc-800 animate-pulse border border-white/10 flex items-center justify-center scale-105 shadow-2xl">
                  <Sparkles className="w-12 h-12 text-zinc-600/30" />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Section 2: Core Library */}
        <section className="mt-[-0.25rem]">
          {/* Sticky Header with integrated safe-area coverage */}
          <div className="sticky top-0 z-30 transition-all duration-300">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl border-b border-white/5"></div>
            <div className="relative px-6 flex items-center justify-between mt-[-env(safe-area-inset-top)] pt-[calc(env(safe-area-inset-top)+0.4rem)] pb-2.5">
              <div className="flex items-center gap-3 overflow-hidden">
                <Library className={cn("shrink-0 text-emerald-400", isMenuOpen ? "w-6 h-6" : "w-7 h-7")} />
                <h2 className={cn(
                  "font-medium text-white tracking-tight whitespace-nowrap",
                  isMenuOpen ? "text-xl" : "text-3xl"
                )}>
                  Core Library
                </h2>
              </div>

              <div className="flex gap-3 items-center">
                {/* Upload / Import Button with Circular Progress */}
                <button
                  onClick={handleImportClick}
                  className="w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-700 shadow-sm shrink-0 active:scale-95"
                >
                  <Upload className="w-5 h-5" />
                </button>

                {/* Filter Group */}
                <div
                  className={cn(
                    "group flex flex-row-reverse items-center p-1 gap-1 h-11 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden shadow-sm",
                    isMenuOpen ? "w-[140px] border-zinc-600" : "w-11 hover:border-zinc-700"
                  )}
                >
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="flex shrink-0 w-9 h-9 items-center justify-center rounded-full text-zinc-400 hover:text-white"
                  >
                    {isMenuOpen ? (
                      <X className="w-5 h-5 text-zinc-500 hover:text-zinc-300 transition-colors" />
                    ) : (
                      <Filter className="w-5 h-5 transition-colors" />
                    )}
                  </button>

                  {/* Separator & Other Buttons */}
                  <div className="flex items-center gap-1" style={{ display: isMenuOpen ? 'flex' : 'none' }}>
                    <div className="w-[1px] h-5 bg-zinc-800 shrink-0 mx-0.5" />

                    <button
                      onClick={() => setActiveFilter(activeFilter === 'reading' ? 'all' : 'reading')}
                      className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0", activeFilter === 'reading' ? "bg-zinc-800 text-indigo-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-indigo-400")}
                    >
                      <BookOpen className="w-5 h-5" />
                    </button>

                    <button
                      onClick={() => setActiveFilter(activeFilter === 'starred' ? 'all' : 'starred')}
                      className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0", activeFilter === 'starred' ? "bg-zinc-800 text-yellow-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-yellow-400")}
                    >
                      <Star className={cn("w-5 h-5", activeFilter === 'starred' ? "fill-current" : "")} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 gap-6 pb-12 px-6 mt-4">
            {displayMaterials.length > 0 ? (
              displayMaterials.map((material: Material) => (
                <div
                  key={material.id}
                  className={cn("scroll-reveal", material.isNew && "animate-slide-in")}
                >
                  <MaterialCard
                    material={material}
                    isActive={false}
                    variant="grid"
                    onClick={() => handleCardClick(material)}
                    onTogglePin={() => handleTogglePin(material.id, material.userMeta?.isPinned || false)}
                    onToggleStar={() => handleToggleStar(material.id, material.userMeta?.isStarred || false)}
                    onRename={material.visibility === 'private' ? () => handleRename(material.id, material.title) : undefined}
                    onDelete={material.visibility === 'private' ? () => handleDelete(material.id) : undefined}
                  />
                </div>
              ))
            ) : isInitialLoading && !loadFailed ? (
              // Skeleton loading state - only show if still loading AND hasn't failed
              <>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="aspect-[4/5] w-full bg-zinc-800 rounded-2xl border border-white/10" />
                  </div>
                ))}
              </>
            ) : (
              // Empty State or Failed State
              <div className="col-span-1 py-12 flex flex-col items-center justify-center text-zinc-500 gap-4">
                <Library className="w-12 h-12 opacity-20 mb-2" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    {loadFailed ? '加载失败' : 'No materials in library'}
                  </p>
                  <p className="text-xs opacity-60">
                    {loadFailed ? '请检查网络连接后重试' : '材料每日更新中'}
                  </p>

                  {/* Manual Retry Button - only show after confirmed timeout */}
                  {loadFailed && (
                    <button
                      onClick={async () => {
                        setLoadFailed(false);
                        setIsInitialLoading(true);

                        try {
                          const progressList = await fetchUserProgress();
                          const [dailySparkItems, coreLibResult] = await Promise.all([
                            materialService.loadDailySparkMaterials(progressList),
                            materialService.loadMaterialsPage(1, 20, progressList)
                          ]);

                          setAllMaterials(prev => {
                            const withoutDailySpark = prev.filter(m => m.location !== 'daily_spark');
                            const withDailySpark = dailySparkItems.length > 0
                              ? materialService.mergeMaterials(withoutDailySpark, dailySparkItems)
                              : withoutDailySpark;
                            return materialService.mergeMaterials(withDailySpark, coreLibResult.items);
                          });

                          if (dailySparkItems.length > 0) {
                            const { value: cachedId } = await Preferences.get({ key: 'daily_spark_id' });
                            setSelectedDailySparkId(cachedId);
                          }
                          setHasMorePages(coreLibResult.hasMore);
                          setCurrentPage(1);
                          setIsInitialLoading(false);
                        } catch (error) {
                          console.error('Manual retry failed:', error);
                          setLoadFailed(true);
                          setIsInitialLoading(false);
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>点击重试</span>
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Partial Failure Retry Button - shows if we have some data (e.g. Daily Spark) but load failed */}
          {loadFailed && displayMaterials.length > 0 && (
            <div className="col-span-1 flex flex-col items-center justify-center py-8 gap-3">
              <p className="text-zinc-500 text-sm">加载中...</p>
              <button
                onClick={async () => {
                  setLoadFailed(false);
                  setIsInitialLoading(true);
                  // Reuse the same retry logic (could be extracted to a function)
                  try {
                    const progressList = await fetchUserProgress();
                    const [dailySparkItems, coreLibResult] = await Promise.all([
                      materialService.loadDailySparkMaterials(progressList),
                      materialService.loadMaterialsPage(1, 20, progressList)
                    ]);

                    setAllMaterials(prev => {
                      const withoutDailySpark = prev.filter(m => m.location !== 'daily_spark');
                      const withDailySpark = dailySparkItems.length > 0
                        ? materialService.mergeMaterials(withoutDailySpark, dailySparkItems)
                        : withoutDailySpark;
                      return materialService.mergeMaterials(withDailySpark, coreLibResult.items);
                    });

                    setHasMorePages(coreLibResult.hasMore);
                    setCurrentPage(1);
                    setIsInitialLoading(false);
                    // Check empty again
                    if (coreLibResult.items.length === 0) setLoadFailed(true);
                  } catch (error) {
                    console.error('Manual retry failed:', error);
                    setLoadFailed(true);
                    setIsInitialLoading(false);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>点击重试</span>
              </button>
            </div>
          )}

          {/* Loading More Indicator */}
          {isLoadingMore && (
            <div className="col-span-1 flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-3 border-blue-500 rounded-full border-t-transparent" />
            </div>
          )}

          {/* All Loaded Indicator */}
          {!hasMorePages && displayMaterials.length > 0 && !isInitialLoading && (
            <div className="col-span-1 text-center py-6 text-zinc-500 text-sm">
            </div>
          )}

          {/* Bottom Feed Status */}
          <div className="mt-8 mb-20 flex flex-col items-center gap-3 opacity-50 animate-in fade-in duration-1000 delay-500">
            <div className="w-8 h-[1px] bg-zinc-800" />
            <span className="text-[10px] text-zinc-500 font-medium tracking-[0.25em] px-4">
              材料每日更新中
            </span>
            <div className="w-8 h-[1px] bg-zinc-800" />
          </div>
        </section>

      </div>

      <Paywall
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSuccess={() => {
          // Reload page to refresh all subscription states
          window.location.reload();
        }}
        source="clicked_locked_card"
      />

      <UploadModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          // Reset to initial after close delay
          setTimeout(() => setUploadStatus('initial'), 300);
        }}
        status={uploadStatus}
        importProgress={importProgress}
        onImport={handleStartImport}
        onUpgrade={() => {
          setShowUploadModal(false);
          setShowPaywall(true);
        }}
        usedSeconds={usedSeconds}
        subscriptionTier={subscriptionTier}
        fileName={importFileName}
        progressMessage={progressMessage}
        errorMessage={errorMessage}
        onSuccessComplete={() => {
          setShowUploadModal(false);
          setTimeout(() => setUploadStatus('initial'), 300);
        }}
      />
    </main>
  );
}
