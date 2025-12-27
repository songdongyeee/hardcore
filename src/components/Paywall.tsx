import { Check, X, Loader2, Zap, Unlock, Mic, UploadCloud, ArrowRight } from "lucide-react";
import { Browser } from '@capacitor/browser';
import { useRevenueCat, ENTITLEMENT_ID } from "@/hooks/useRevenueCat";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { Purchases } from "@revenuecat/purchases-capacitor";
import { pb } from "@/lib/api";


interface PaywallProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function Paywall({ isOpen, onClose, onSuccess }: PaywallProps) {
    const { currentOffering, purchasePackage, isReady } = useRevenueCat();
    const [loading, setLoading] = useState(false);
    const [selectedPackage, setSelectedPackage] = useState<PurchasesPackage | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [pbSubscriptionTier, setPbSubscriptionTier] = useState<'free' | 'monthly' | 'quarterly' | 'yearly'>('free');

    // Handle visibility for transition
    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
        } else {
            const timer = setTimeout(() => setIsVisible(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Fetch subscription tier from PocketBase for stable detection
    useEffect(() => {
        if (pb.authStore.isValid && pb.authStore.model?.id) {
            pb.collection('users').getOne(pb.authStore.model.id)
                .then(user => {
                    const tier = user.subscription_tier || 'free';
                    setPbSubscriptionTier(tier);
                    console.log('[Paywall] PocketBase subscription_tier:', tier);
                })
                .catch(err => {
                    console.error('[Paywall] Failed to fetch subscription tier:', err);
                });
        }
    }, [isOpen]); // Refresh when paywall opens

    // Find packages
    const monthlyPackage = currentOffering?.availablePackages.find(p => p.identifier === 'monthly') || currentOffering?.monthly;
    const quarterlyPackage = currentOffering?.availablePackages.find(p => p.identifier === 'three_month' || p.identifier === 'quarterly') || currentOffering?.threeMonth;
    const annualPackage = currentOffering?.availablePackages.find(p => p.identifier === 'annual' || p.identifier === 'yearly') || currentOffering?.annual;

    // Filter packages based on current tier (only show upgrades)
    // Use PocketBase tier for stability
    const currentTier = pbSubscriptionTier;
    const shouldShowMonthly = currentTier === 'free';
    const shouldShowQuarterly = currentTier === 'free' || currentTier === 'monthly';
    const shouldShowAnnual = currentTier !== 'yearly';
    const isYearlyMember = currentTier === 'yearly';

    // Set default selection when offering loads
    useEffect(() => {
        if (annualPackage) {
            setSelectedPackage(annualPackage);
        } else if (monthlyPackage) {
            setSelectedPackage(monthlyPackage);
        }
    }, [currentOffering, annualPackage, monthlyPackage]);

    if (!isVisible && !isOpen) return null;

    const handleSubscribe = async () => {
        if (!selectedPackage) return;
        setLoading(true);

        const result = await purchasePackage(selectedPackage);
        if (result.success) {
            // Sync subscription to PocketBase
            // IMPORTANT: Must extract tier from result.customerInfo directly
            // because the hook's customerInfo state may not have updated yet
            try {
                if (pb.authStore.isValid && pb.authStore.model?.id && result.customerInfo) {
                    const freshCustomerInfo = result.customerInfo;

                    // Extract tier from fresh customerInfo
                    let tier: 'free' | 'monthly' | 'quarterly' | 'yearly' = 'free';
                    let expirationDate: string | null = null;

                    if (freshCustomerInfo.entitlements?.active[ENTITLEMENT_ID]) {
                        const entitlement = freshCustomerInfo.entitlements.active[ENTITLEMENT_ID];
                        const productId = entitlement.productIdentifier?.toLowerCase() || '';

                        // Map product IDs to tiers
                        if (productId.includes('monthly')) tier = 'monthly';
                        else if (productId.includes('quarterly') || productId.includes('quarter')) tier = 'quarterly';
                        else if (productId.includes('yearly') || productId.includes('annual')) tier = 'yearly';

                        expirationDate = entitlement.expirationDate || null;
                    }

                    await pb.collection('users').update(pb.authStore.model.id, {
                        subscription_tier: tier,
                        quota_reset_date: expirationDate,
                        used_seconds: 0
                    });
                    console.log(`✅ Purchase successful, synced to PB: ${tier} `, { expirationDate });
                }
            } catch (e) {
                console.error('Failed to sync subscription:', e);
            }

            onSuccess();
            onClose();
        }
        setLoading(false);
    };

    const handleRestore = async () => {
        setLoading(true);

        try {
            // Get fresh customer info from restore
            const { customerInfo: freshInfo } = await Purchases.restorePurchases();

            if (freshInfo?.entitlements?.active[ENTITLEMENT_ID]) {
                // Calculate tier directly from fresh customer info
                const entitlement = freshInfo.entitlements.active[ENTITLEMENT_ID];
                const productId = entitlement.productIdentifier?.toLowerCase() || '';

                let tier: 'free' | 'monthly' | 'quarterly' | 'yearly' = 'free';
                if (productId.includes('monthly')) tier = 'monthly';
                else if (productId.includes('quarterly') || productId.includes('quarter')) tier = 'quarterly';
                else if (productId.includes('yearly') || productId.includes('annual')) tier = 'yearly';

                // Sync to PocketBase with fresh tier
                if (pb.authStore.isValid && pb.authStore.model?.id) {
                    await pb.collection('users').update(pb.authStore.model.id, {
                        subscription_tier: tier,
                        quota_reset_date: entitlement.expirationDate,
                        used_seconds: 0
                    });
                    console.log(`✅ Subscription restored and synced: ${tier} `);
                }

                alert("Restore Successful! VIP Unlocked.");
                // Reload page to refresh all states
                window.location.reload();
            } else {
                alert("No active subscription found to restore.");
            }
        } catch (e: any) {
            console.error('Failed to restore or sync subscription:', e);
            alert("Restore Failed: " + e.message);
        }

        setLoading(false);
    }

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col justify-end">
            {/* Backdrop */}
            <div
                className={cn(
                    "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0"
                )}
                onClick={onClose}
            />

            {/* High Bottom Sheet */}
            <div
                className={cn(
                    "relative w-full max-w-md mx-auto bg-[#0A0A0A] border-t border-white/10 rounded-t-[2.5rem] overflow-hidden shadow-2xl transform transition-transform duration-300 ease-out flex flex-col max-h-[95vh]",
                    isOpen ? "translate-y-0" : "translate-y-full"
                )}
            >
                {/* Background Ambient Glows */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none"></div>

                {/* Header */}
                <div className="flex justify-between items-center p-6 relative z-10 shrink-0">
                    <button
                        onClick={handleRestore}
                        className="text-sm font-medium text-zinc-500 hover:text-white transition-colors tracking-wide"
                    >
                        恢复购买
                    </button>
                    <button
                        onClick={onClose}
                        className="bg-white/5 hover:bg-white/10 p-2 rounded-full transition-colors backdrop-blur-sm"
                    >
                        <X className="w-5 h-5 text-zinc-400" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-8 pb-6">
                    {/* Hero Section */}
                    <div className="text-center pt-2 pb-6">
                        {/* Icon */}
                        <div className="mx-auto w-16 h-16 bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_50px_-10px_rgba(99,102,241,0.3)]">
                            <Zap className="w-8 h-8 text-indigo-400 fill-indigo-400/20" />
                        </div>

                        {/* Title */}
                        <h1 className="text-3xl font-semibold text-white tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-br from-white to-zinc-400">
                            升级高级会员
                        </h1>
                    </div>

                    {/* Features List */}
                    <div className="space-y-4 mb-8">
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-500/10 p-1.5 rounded-full shrink-0">
                                <Unlock className="w-4 h-4 text-indigo-400" />
                            </div>
                            <span className="text-base font-medium text-zinc-300">解锁全部学习材料</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-500/10 p-1.5 rounded-full shrink-0">
                                <Mic className="w-4 h-4 text-indigo-400" />
                            </div>
                            <span className="text-base font-medium text-zinc-300">录音保存功能</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-500/10 p-1.5 rounded-full shrink-0">
                                <UploadCloud className="w-4 h-4 text-indigo-400" />
                            </div>
                            <span className="text-base font-medium text-zinc-300">更高的文件上传额度</span>
                        </div>
                    </div>

                    {/* Pricing Selection */}
                    <div className="space-y-3 mb-6">
                        {/* Special Message for Yearly Members */}
                        {isYearlyMember && (
                            <div className="p-6 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/30">
                                <div className="flex items-start gap-4">
                                    <div className="bg-indigo-500/20 p-3 rounded-full shrink-0">
                                        <Zap className="w-6 h-6 text-indigo-400" />
                                    </div>
                                    <div className="flex-1 space-y-3">
                                        <h3 className="text-lg font-semibold text-white">您已是年度会员</h3>
                                        <p className="text-sm text-zinc-300 leading-relaxed">
                                            额度不够用？作为我们的高级用户，您可以直接通过以下方式联系开发者为您提额：
                                        </p>
                                        <div className="space-y-2 text-sm text-zinc-400">
                                            <div className="flex items-center gap-2">
                                                <span className="text-indigo-400">•</span>
                                                <span>App Store 开发者邮箱</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-indigo-400">•</span>
                                                <span>社交媒体平台私信</span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-zinc-500 mt-3">
                                            我们会尽快为您处理提额请求
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* Option 1: Monthly */}
                        {shouldShowMonthly && monthlyPackage && (
                            <label
                                onClick={() => setSelectedPackage(monthlyPackage)}
                                className={cn(
                                    "group relative flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                                    selectedPackage?.identifier === monthlyPackage.identifier
                                        ? "border-indigo-500/50 bg-indigo-500/5 shadow-[0_0_20px_-5px_rgba(99,102,241,0.15)]"
                                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
                                )}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                                        selectedPackage?.identifier === monthlyPackage.identifier
                                            ? "bg-indigo-500 border-indigo-500"
                                            : "border-zinc-600 group-hover:border-zinc-400"
                                    )}>
                                        {selectedPackage?.identifier === monthlyPackage.identifier && <Check className="w-3 h-3 text-white stroke-[3]" />}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-base font-medium text-white">月度会员</span>
                                        <span className="text-xs text-zinc-500">30分钟上传额度 · 单次最大500MB</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block text-base font-medium text-white">{monthlyPackage.product.priceString}</span>
                                    <span className="block text-xs text-zinc-500">/月</span>
                                </div>
                            </label>
                        )}

                        {/* Option 2: Quarterly */}
                        {shouldShowQuarterly && quarterlyPackage && (
                            <label
                                onClick={() => setSelectedPackage(quarterlyPackage)}
                                className={cn(
                                    "group relative flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                                    selectedPackage?.identifier === quarterlyPackage.identifier
                                        ? "border-indigo-500/50 bg-indigo-500/5 shadow-[0_0_20px_-5px_rgba(99,102,241,0.15)]"
                                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
                                )}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                                        selectedPackage?.identifier === quarterlyPackage.identifier
                                            ? "bg-indigo-500 border-indigo-500"
                                            : "border-zinc-600 group-hover:border-zinc-400"
                                    )}>
                                        {selectedPackage?.identifier === quarterlyPackage.identifier && <Check className="w-3 h-3 text-white stroke-[3]" />}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-base font-medium text-white">季度会员</span>
                                        <span className="text-xs text-zinc-500" style={{ color: selectedPackage?.identifier === quarterlyPackage.identifier ? '#a5b4fc' : undefined }}>180分钟上传额度 · 单次最大1GB</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block text-base font-medium text-white">{quarterlyPackage.product.priceString}</span>
                                    <span className="block text-xs text-zinc-500">/季</span>
                                </div>
                            </label>
                        )}

                        {/* Option 3: Yearly (RECOMMENDED) */}
                        {shouldShowAnnual && annualPackage && (
                            <label
                                onClick={() => setSelectedPackage(annualPackage)}
                                className={cn(
                                    "relative flex items-center justify-between p-4 rounded-xl border-2 transition-all cursor-pointer active:scale-[0.99]",
                                    selectedPackage?.identifier === annualPackage.identifier
                                        ? "border-indigo-500 bg-indigo-500/10 shadow-[0_0_25px_-5px_rgba(99,102,241,0.25)] scale-[1.02] z-10"
                                        : "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10"
                                )}
                            >
                                {/* Best Value Badge */}
                                <div className="absolute -top-3 right-4 bg-indigo-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider uppercase shadow-lg z-20">
                                    首推 · 省钱超值
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-colors",
                                        selectedPackage?.identifier === annualPackage.identifier
                                            ? "bg-indigo-500"
                                            : "bg-indigo-500/20"
                                    )}>
                                        <Check className={cn(
                                            "w-3 h-3 text-white stroke-[3]",
                                            selectedPackage?.identifier === annualPackage.identifier ? "opacity-100" : "opacity-0"
                                        )} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-base font-bold text-white">年度会员</span>
                                        <span className="text-xs font-medium text-indigo-300/80">1200分钟上传额度 · 不限文件大小 🔥</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block text-lg font-bold text-white">{annualPackage.product.priceString}</span>
                                    <span className="block text-[10px] font-medium text-indigo-300/80 uppercase">
                                        {annualPackage.product.price / 12 < 10
                                            ? `仅需 ${annualPackage.product.priceString.replace(/[0-9.,\s]/g, '')}${(annualPackage.product.price / 12).toFixed(2)}/月`
                                            : "物超所值"}
                                    </span >
                                </div >
                            </label >
                        )}
                    </div>
                </div>

                {/* Footer / CTA */}
                <div className="p-6 pt-4 bg-gradient-to-t from-[#0A0A0A] to-[#0A0A0A]/0 shrink-0">
                    <button
                        onClick={handleSubscribe}
                        disabled={loading || !selectedPackage || !isReady}
                        className="w-full py-4 bg-white text-black font-bold text-lg rounded-full hover:bg-zinc-200 transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {loading
                            ? <Loader2 className="w-6 h-6 animate-spin text-zinc-900" />
                            : (
                                <>
                                    立即开通会员
                                    <ArrowRight className="w-5 h-5" />
                                </>
                            )
                        }
                    </button>
                    <p className="text-center text-[10px] text-zinc-600 mt-4 leading-relaxed px-4 font-light">
                        确认购买即表示您同意我们的
                        <span
                            onClick={() => Browser.open({ url: 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/' })}
                            className="mx-1 text-zinc-500 underline decoration-zinc-800 cursor-pointer hover:text-zinc-800"
                        >
                            服务条款
                        </span>
                        与
                        <span
                            onClick={() => Browser.open({ url: 'https://zjcnex.top/privacy.html' })}
                            className="mx-1 text-zinc-500 underline decoration-zinc-800 cursor-pointer hover:text-zinc-800"
                        >
                            隐私政策
                        </span>。
                        订阅将通过您的 Apple ID 账户自动续费。
                    </p>
                </div>
            </div>
        </div>
    );
}
