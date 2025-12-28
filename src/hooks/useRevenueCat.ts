import { useEffect, useState } from 'react';
import { Purchases, LOG_LEVEL, type PurchasesPackage, type PurchasesOffering } from '@revenuecat/purchases-capacitor';
import { pb } from '@/lib/api';
// Global init flag to prevent hitting RC multiple times if hook is used in multiple components simultaneously
let isConfigured = false;

// Credentials provided by user
const API_KEY = "appl_ItWPUWsRrylahhZdTrBpvJbEtIo";
export const ENTITLEMENT_ID = "app_pro";

export function useRevenueCat() {
    const [currentOffering, setCurrentOffering] = useState<PurchasesOffering | null>(null);
    const [customerInfo, setCustomerInfo] = useState<any>(null);
    const [isReady, setIsReady] = useState(false);
    const [isVip, setIsVip] = useState(false);
    const [subscriptionTier, setSubscriptionTier] = useState<'free' | 'monthly' | 'quarterly' | 'yearly'>('free');

    useEffect(() => {
        let customerInfoListener: any = null;

        const init = async () => {
            try {
                if (import.meta.env.VITE_PLATFORM === 'web') return; // Skip on web

                if (!isConfigured) {
                    await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
                    await Purchases.configure({ apiKey: API_KEY });
                    isConfigured = true;
                }

                // Listener for updates (Renewals, Restores, Purchases from other devices)
                customerInfoListener = await Purchases.addCustomerInfoUpdateListener((info) => {
                    setCustomerInfo(info);
                    checkEntitlement(info);
                });

                // Get info
                const info = await Purchases.getCustomerInfo();
                setCustomerInfo(info);
                checkEntitlement(info);

                // Get offerings
                const offerings = await Purchases.getOfferings();
                if (offerings.current !== null) {
                    setCurrentOffering(offerings.current);
                }

                setIsReady(true);
            } catch (e) {
                console.error("RevenueCat Init Error:", e);
            }
        };

        init();

        return () => {
            if (customerInfoListener) {
                // remove() returns a promise or void depending on version, safe to call
                try { customerInfoListener.remove(); } catch (e) { }
            }
        };
    }, []);

    // Helper function to detect subscription tier from customerInfo
    const getSubscriptionTier = (info: any): 'free' | 'monthly' | 'quarterly' | 'yearly' => {
        if (!info?.entitlements?.active[ENTITLEMENT_ID]) return 'free';

        const entitlement = info.entitlements.active[ENTITLEMENT_ID];
        const productId = entitlement.productIdentifier?.toLowerCase() || '';

        // Map product IDs to tiers (Monthly, hardcore_quarterly, hardcore_yearly)
        if (productId.includes('monthly')) return 'monthly';
        if (productId.includes('quarterly') || productId.includes('quarter')) return 'quarterly';
        if (productId.includes('yearly') || productId.includes('annual')) return 'yearly';

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
        const isActive = info?.entitlements?.active[ENTITLEMENT_ID];
        if (isActive) {
            setIsVip(true);
            // Update subscription tier
            const tier = getSubscriptionTier(info);
            setSubscriptionTier(tier);
        } else {
            setIsVip(false);
            setSubscriptionTier('free');
        }
    };

    // Auto-sync subscription to PocketBase when customerInfo changes
    useEffect(() => {
        const syncToPocketBase = async () => {
            if (!customerInfo || !isReady) return;
            if (!pb.authStore.isValid || !pb.authStore.model?.id) return;

            try {
                const subInfo = getSubscriptionInfo();
                const user = await pb.collection('users').getOne(pb.authStore.model.id);

                // Log status for debugging
                console.log(`[useRevenueCat] Sync Check: RC Tier=${subInfo.tier}, PB Tier=${user.subscription_tier}`);

                // Always sync upgrades (free -> paid)
                const upgradedToPaid = user.subscription_tier === 'free' && subInfo.tier !== 'free';
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
                console.warn('Failed to auto-sync subscription:', e);
            }
        };

        syncToPocketBase();
    }, [customerInfo, isReady]);

    const purchasePackage = async (rcPackage: PurchasesPackage) => {
        try {
            const { customerInfo } = await Purchases.purchasePackage({ aPackage: rcPackage });
            checkEntitlement(customerInfo);
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
