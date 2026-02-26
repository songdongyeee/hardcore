import { useEffect, useState } from 'react';
import { Purchases, LOG_LEVEL, type PurchasesPackage, type PurchasesOffering } from '@revenuecat/purchases-capacitor';
import { pb } from '@/lib/api';
import { App as CapApp } from '@capacitor/app';
import { analytics } from '@/lib/analytics'; // Restore analytics
// Global init flag to prevent hitting RC multiple times if hook is used in multiple components simultaneously
let isConfigured = false;
let configurePromise: Promise<void> | null = null;
let initPromise: Promise<void> | null = null;
let hasBootstrapped = false;
let customerInfoListener: any = null;
let appStateListener: any = null;
let lastPbSyncSignature = '';

// Credentials provided by user
const API_KEY = "appl_ItWPUWsRrylahhZdTrBpvJbEtIo";
const RC_PROXY_URL = (import.meta.env.VITE_RC_PROXY_URL || '').trim();
export const ENTITLEMENT_ID = "app_pro";

import { Preferences } from '@capacitor/preferences'; // Cache Support

type SubscriptionTier = 'free' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime';

type SharedRCState = {
    currentOffering: PurchasesOffering | null;
    customerInfo: any;
    isReady: boolean;
    isVip: boolean;
    subscriptionTier: SubscriptionTier;
};

let sharedRCState: SharedRCState = {
    currentOffering: null,
    customerInfo: null,
    isReady: false,
    isVip: false,
    subscriptionTier: 'free'
};

const sharedStateSubscribers = new Set<(state: SharedRCState) => void>();

const emitSharedState = () => {
    for (const subscriber of sharedStateSubscribers) {
        subscriber(sharedRCState);
    }
};

const setSharedState = (patch: Partial<SharedRCState>) => {
    sharedRCState = { ...sharedRCState, ...patch };
    emitSharedState();
};

const getSubscriptionTierFromInfo = (info: any): SubscriptionTier => {
    if (!info?.entitlements?.active?.[ENTITLEMENT_ID]) return 'free';

    const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    const productId = entitlement.productIdentifier?.toLowerCase() || '';

    if (productId.includes('monthly')) return 'monthly';
    if (productId.includes('quarterly') || productId.includes('quarter')) return 'quarterly';
    if (productId.includes('yearly') || productId.includes('annual')) return 'yearly';
    if (productId.includes('lifetime')) return 'lifetime';

    return 'free';
};

const applyCustomerInfoToShared = (info: any) => {
    const tier = getSubscriptionTierFromInfo(info);
    const isVip = !!info?.entitlements?.active?.[ENTITLEMENT_ID];
    setSharedState({
        customerInfo: info,
        subscriptionTier: tier,
        isVip
    });
};

const ensureConfigured = async () => {
    if (isConfigured) return;
    if (configurePromise) {
        await configurePromise;
        return;
    }

    configurePromise = (async () => {
        await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });

        if (RC_PROXY_URL) {
            try {
                await Purchases.setProxyURL({ url: RC_PROXY_URL });
                console.log('🌐 RevenueCat proxy enabled:', RC_PROXY_URL);
            } catch (proxyErr) {
                // Proxy config failed: keep direct RC path so purchase flow is not blocked.
                console.warn('⚠️ RevenueCat proxy setup failed, falling back to direct host', proxyErr);
            }
        } else {
            console.log('ℹ️ RevenueCat proxy not configured (VITE_RC_PROXY_URL empty)');
        }

        await Purchases.configure({ apiKey: API_KEY });
        isConfigured = true;
    })().finally(() => {
        configurePromise = null;
    });

    await configurePromise;
};

const initRevenueCat = async (retryCount = 0) => {
    if (initPromise) {
        await initPromise;
        return;
    }

    initPromise = (async () => {
        try {
            if (import.meta.env.VITE_PLATFORM === 'web') return; // Skip on web

            await ensureConfigured();

            // Listener for updates (Renewals, Restores, Purchases from other devices)
            if (!customerInfoListener) {
                customerInfoListener = await Purchases.addCustomerInfoUpdateListener((info) => {
                    applyCustomerInfoToShared(info);
                });
            }

            const info = await Purchases.getCustomerInfo();
            applyCustomerInfoToShared(info);

            if (info.customerInfo?.originalAppUserId) {
                syncRevenueCatIdToPocketBase(info.customerInfo.originalAppUserId);
            }

            const offerings = await Purchases.getOfferings();
            if (offerings.current !== null) {
                setSharedState({ currentOffering: offerings.current });
            }

            setSharedState({ isReady: true });
            console.log('✅ RevenueCat initialized successfully');
        } catch (e) {
            console.error("RevenueCat Init Error:", e);

            if (retryCount < 8) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
                console.log(`⏳ Retrying RevenueCat init in ${delay / 1000}s... (attempt ${retryCount + 1}/8)`);
                window.setTimeout(() => {
                    initRevenueCat(retryCount + 1);
                }, delay);
            } else {
                console.warn('⚠️ RevenueCat initialization failed after 8 attempts.');
                setSharedState({ isReady: true });
            }
        }
    })().finally(() => {
        initPromise = null;
    });

    await initPromise;
};

const bootstrapRevenueCat = () => {
    if (hasBootstrapped) return;
    hasBootstrapped = true;

    initRevenueCat(0);

    if (import.meta.env.VITE_PLATFORM !== 'web' && !appStateListener) {
        appStateListener = CapApp.addListener('appStateChange', (state) => {
            if (state.isActive && !sharedRCState.isReady) {
                console.log('📱 App became active, retrying RevenueCat init...');
                initRevenueCat(0);
            }
        });
    }
};

// ✅ 同步RevenueCat ID到PocketBase
async function syncRevenueCatIdToPocketBase(rcUserId: string) {
    try {
        // 💾 Cache execution: Save valid RC ID for next cold start
        await Preferences.set({ key: 'last_rc_id', value: rcUserId });

        if (!pb.authStore.isValid || !pb.authStore.model?.id) {
            console.log('[RC-PB Sync] PB not logged in, skip');
            return;
        }
        const currentRevId = pb.authStore.model.revenue_id;
        if (currentRevId === rcUserId) {
            console.log('[RC-PB Sync] ✅ Already synced:', rcUserId);
            return;
        }
        await pb.collection('users').update(pb.authStore.model.id, {
            revenue_id: rcUserId
        });
        console.log('[RC-PB Sync] ✅ Synced RC ID to PB:', rcUserId);
    } catch (e) {
        console.error('[RC-PB Sync] Failed:', e);
    }
}

export function useRevenueCat() {
    const [currentOffering, setCurrentOffering] = useState<PurchasesOffering | null>(sharedRCState.currentOffering);
    const [customerInfo, setCustomerInfo] = useState<any>(sharedRCState.customerInfo);
    const [isReady, setIsReady] = useState(sharedRCState.isReady);
    const [isVip, setIsVip] = useState(sharedRCState.isVip);
    const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>(sharedRCState.subscriptionTier);

    useEffect(() => {
        const syncLocalState = (state: SharedRCState) => {
            setCurrentOffering(state.currentOffering);
            setCustomerInfo(state.customerInfo);
            setIsReady(state.isReady);
            setIsVip(state.isVip);
            setSubscriptionTier(state.subscriptionTier);
        };

        sharedStateSubscribers.add(syncLocalState);
        syncLocalState(sharedRCState);
        bootstrapRevenueCat();

        return () => {
            sharedStateSubscribers.delete(syncLocalState);
        };
    }, []);

    // Helper function to detect subscription tier from customerInfo
    const getSubscriptionTier = (info: any): 'free' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime' => {
        if (!info?.entitlements?.active[ENTITLEMENT_ID]) return 'free';

        const entitlement = info.entitlements.active[ENTITLEMENT_ID];
        const productId = entitlement.productIdentifier?.toLowerCase() || '';

        // Map product IDs to tiers (Monthly, hardcore_quarterly, hardcore_yearly, lifetime)
        if (productId.includes('monthly')) return 'monthly';
        if (productId.includes('quarterly') || productId.includes('quarter')) return 'quarterly';
        if (productId.includes('yearly') || productId.includes('annual')) return 'yearly';
        if (productId.includes('lifetime')) return 'lifetime';

        return 'free'; // fallback
    };

    // Helper function to get subscription info including expiration date
    const getSubscriptionInfo = () => {
        if (!customerInfo?.entitlements?.active[ENTITLEMENT_ID]) {
            return { tier: 'free' as const, expirationDate: null };
        }

        const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
        const tier = getSubscriptionTier(customerInfo);
        const expirationDate = entitlement.expirationDate;

        return { tier, expirationDate };
    };

    const checkEntitlement = (info: any) => {
        applyCustomerInfoToShared(info);
    };

    // Auto-sync subscription to PocketBase when customerInfo changes
    useEffect(() => {
        const syncToPocketBase = async () => {
            if (!customerInfo || !isReady) return;
            if (!pb.authStore.isValid || !pb.authStore.model?.id) return;

            const syncSignature = `${pb.authStore.model.id}:${customerInfo?.requestDateMillis || customerInfo?.requestDate || 'no_request'}:${customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]?.productIdentifier || 'free'}`;
            if (syncSignature === lastPbSyncSignature) return;
            lastPbSyncSignature = syncSignature;

            try {
                const subInfo = getSubscriptionInfo();
                const user = await pb.collection('users').getOne(pb.authStore.model.id);

                // Log status for debugging
                console.log(`[useRevenueCat] Sync Check: RC Tier=${subInfo.tier}, PB Tier=${user.subscription_tier}`);

                // Always sync upgrades (free/null -> paid)
                const upgradedToPaid = (!user.subscription_tier || user.subscription_tier === 'free') && subInfo.tier !== 'free';
                // Also sync if user is already paid but changed plans (e.g., monthly -> yearly)
                const planChanged = user.subscription_tier !== 'free' && subInfo.tier !== 'free' && user.subscription_tier !== subInfo.tier;

                // ✅ Detect renewal: tier stays the same but expiration date is extended
                const renewed = user.subscription_tier === subInfo.tier &&
                    subInfo.tier !== 'free' &&
                    subInfo.expirationDate &&
                    user.quota_reset_date &&
                    new Date(subInfo.expirationDate) > new Date(user.quota_reset_date);

                if (upgradedToPaid || planChanged || renewed) {
                    const updateData: any = {
                        subscription_tier: subInfo.tier,
                        quota_reset_date: subInfo.expirationDate,
                    };

                    if (upgradedToPaid) {
                        updateData.used_seconds = 0; // Reset quota on first upgrade
                    }

                    // ✅ Also reset quota on renewal
                    if (renewed) {
                        updateData.used_seconds = 0; // Reset quota on renewal
                    }

                    await pb.collection('users').update(pb.authStore.model.id, updateData);

                    if (renewed) {
                        console.log(`🔄 Subscription renewed: ${subInfo.tier}, new expiration: ${subInfo.expirationDate}`);
                    } else {
                        console.log(`✨ Auto-synced update: ${user.subscription_tier} -> ${subInfo.tier}`);
                    }
                    return;
                }

                // [IMPORTANT] REMOVED AUTOMATIC EXPIRATION HERE
                // To prevent sandbox environment issues from incorrectly expiring subscriptions.
                // Subscription expiration should only happen via:
                // 1. Explicit restorePurchases (user triggered)
                // 2. Server-side cron job (secure way)
                // 3. App boot check with high confidence (not implemented here yet)

                // When RC shows free but PB shows paid
                if (user.subscription_tier !== 'free' && subInfo.tier === 'free') {
                    // Check if truly expired before skipping
                    const quotaResetDate = user.quota_reset_date;
                    const isExpired = quotaResetDate && new Date(quotaResetDate) < new Date();

                    if (isExpired) {
                        // Truly expired, reset to free
                        console.log(`⏰ Subscription expired. Resetting ${user.subscription_tier} -> free`);
                        await pb.collection('users').update(pb.authStore.model.id, {
                            subscription_tier: 'free',
                            quota_reset_date: null
                        });
                    } else {
                        // Not expired, sandbox issue - protect subscription
                        console.log(`⚠️ RC shows free but user is ${user.subscription_tier} in PB (not expired). Skipping auto-expiration to avoid sandbox errors.`);
                    }
                }
            } catch (e) {
                lastPbSyncSignature = '';
                console.warn('Failed to auto-sync subscription:', e);
            }
        };

        syncToPocketBase();
    }, [customerInfo, isReady]);

    const purchasePackage = async (rcPackage: PurchasesPackage) => {
        try {
            const { customerInfo } = await Purchases.purchasePackage({ aPackage: rcPackage });
            checkEntitlement(customerInfo);

            // Analytics: Track Subscription Success
            analytics.track('subscription_started', {
                tier: rcPackage.product.title,
                value: rcPackage.product.price,
                currency: rcPackage.product.currencyCode
            });

            // ✅ 同步RC ID到PB（购买成功后）
            if (customerInfo.originalAppUserId) {
                syncRevenueCatIdToPocketBase(customerInfo.originalAppUserId);
            }

            return { success: true, customerInfo };
        } catch (e: any) {
            if (!e.userCancelled) {
                alert("Purchase Failed: " + e.message);
            }
            return { success: false, error: e };
        }
    };

    const restorePurchases = async () => {
        try {
            const { customerInfo } = await Purchases.restorePurchases();
            checkEntitlement(customerInfo);

            // ✅ PROTECTION: Only sync if there's an active subscription
            if (customerInfo?.entitlements?.active[ENTITLEMENT_ID]) {
                const tier = getSubscriptionTier(customerInfo);
                const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

                if (pb.authStore.isValid && pb.authStore.model?.id) {
                    await pb.collection('users').update(pb.authStore.model.id, {
                        subscription_tier: tier,
                        quota_reset_date: entitlement.expirationDate || null
                    });

                    // ✅ 同步RC ID到PB（恢复购买后）
                    if (customerInfo.originalAppUserId) {
                        syncRevenueCatIdToPocketBase(customerInfo.originalAppUserId);
                    }
                    console.log(`🔄 Restore successful: ${tier}`);
                }

                alert("恢复购买成功！VIP 已解锁。");
                return true;
            } else {
                // ⚠️ No active subscription found
                // CRITICAL: Check current PB status before showing error
                console.warn("⚠️ RestorePurchases returned no active subscriptions");

                if (pb.authStore.isValid && pb.authStore.model?.id) {
                    const user = await pb.collection('users').getOne(pb.authStore.model.id);

                    if (user.subscription_tier !== 'free') {
                        // User has a subscription in PB but not in RC
                        // This could be:
                        // 1. Sandbox environment issue (most likely)
                        // 2. Subscription expired but not yet synced

                        // Check if subscription is truly expired
                        const quotaResetDate = user.quota_reset_date;
                        const isExpired = quotaResetDate && new Date(quotaResetDate) < new Date();

                        if (isExpired) {
                            // Truly expired, reset to free
                            await pb.collection('users').update(pb.authStore.model.id, {
                                subscription_tier: 'free',
                                quota_reset_date: null
                            });
                            console.log(`⏰ Subscription expired, reset to free`);
                            alert("您的订阅已过期。如需继续使用高级功能，请重新订阅。");
                        } else {
                            // Not expired, sandbox issue
                            alert(`检测到您已有 ${user.subscription_tier} 订阅。如遇到问题，请稍后重试或联系支持。`);
                        }
                    } else {
                        alert("未找到可恢复的订阅。请确保使用购买时的 Apple ID 登录。");
                    }
                } else {
                    alert("未找到可恢复的订阅。请确保使用购买时的 Apple ID 登录。");
                }
                return false;
            }
        } catch (e: any) {
            console.error("恢复购买失败:", e);
            alert("恢复购买失败: " + (e.message || "未知错误"));
            return false;
        }
    };

    return {
        isReady,
        currentOffering,
        customerInfo,
        appUserID: customerInfo?.originalAppUserId || null,
        purchasePackage,
        restorePurchases,
        isVip,
        subscriptionTier,
        getSubscriptionInfo
    };
}
