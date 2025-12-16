import { useEffect, useState } from 'react';
import { Purchases, LOG_LEVEL, type PurchasesPackage, type PurchasesOffering } from '@revenuecat/purchases-capacitor';
// Global init flag to prevent hitting RC multiple times if hook is used in multiple components simultaneously
let isConfigured = false;

// Credentials provided by user
const API_KEY = "appl_ItWPUWsRrylahhZdTrBpvJbEtIo";
const ENTITLEMENT_ID = "app_pro";

export function useRevenueCat() {
    const [currentOffering, setCurrentOffering] = useState<PurchasesOffering | null>(null);
    const [customerInfo, setCustomerInfo] = useState<any>(null);
    const [isReady, setIsReady] = useState(false);
    const [isVip, setIsVip] = useState(false);

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

    const checkEntitlement = (info: any) => {
        const isActive = info?.entitlements?.active[ENTITLEMENT_ID];
        if (isActive) {
            setIsVip(true);
        } else {
            setIsVip(false);
        }
    };

    const purchasePackage = async (rcPackage: PurchasesPackage) => {
        try {
            const { customerInfo } = await Purchases.purchasePackage({ aPackage: rcPackage });
            checkEntitlement(customerInfo);
            return { success: true };
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
            if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
                alert("Restore Successful! VIP Unlocked.");
                return true;
            } else {
                alert("No active subscription found to restore.");
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
        purchasePackage,
        restorePurchases,
        isVip
    };
}
