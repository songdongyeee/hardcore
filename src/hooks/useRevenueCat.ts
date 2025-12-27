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

                if (upgradedToPaid || planChanged) {
                    const updateData: any = {
                        subscription_tier: subInfo.tier,
                        quota_reset_date: subInfo.expirationDate,
                    };

                    if (upgradedToPaid) {
                        updateData.used_seconds = 0; // Reset quota on first upgrade
                    }

                    await pb.collection('users').update(pb.authStore.model.id, updateData);
                    console.log(`✨ Auto-synced update: ${user.subscription_tier} -> ${subInfo.tier}`);
                    return;
                }

                // [IMPORTANT] REMOVED AUTOMATIC DOWNGRADE HERE
                // To prevent sandbox environment issues from incorrectly downgrading users.
                // Downgrades should only happen via:
                // 1. Explicit restorePurchases (user triggered)
                // 2. Server-side cron job (secure way)
                // 3. App boot check with high confidence (not implemented here yet)

                if (user.subscription_tier !== 'free' && subInfo.tier === 'free') {
                    console.log(`⚠️ RC shows free but user is ${user.subscription_tier} in PB. Skipping auto-downgrade to avoid sandbox errors.`);
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

            // Force sync to PocketBase on manual restore
            if (pb.authStore.isValid && pb.authStore.model?.id) {
                const tier = getSubscriptionTier(customerInfo);
                const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

                await pb.collection('users').update(pb.authStore.model.id, {
                    subscription_tier: tier,
                    quota_reset_date: entitlement?.expirationDate || null
                });
                console.log(`🔄 Manual restore sync: PocketBase updated to ${tier}`);
            }

            if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
                alert("Restore Successful! VIP Unlocked.");
                return true;
            } else {
                alert("No active subscription found to restore. If you already purchased, please wait a moment and try again.");
                return false;
            }
        } catch (e: any) {
            alert("Restore Failed: " + e.message);
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
