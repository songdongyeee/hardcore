import { X, Check, Loader2 } from "lucide-react";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { useState } from "react";

interface PaywallProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function Paywall({ isOpen, onClose, onSuccess }: PaywallProps) {
    const { currentOffering, purchasePackage, restorePurchases, isReady } = useRevenueCat();
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    // Find custom 'monthly' package or fallback to standard monthly
    const monthlyPackage = currentOffering?.availablePackages.find(p => p.identifier === 'monthly')
        || currentOffering?.monthly;

    // Fallback price text
    const priceString = monthlyPackage?.product.priceString || "¥28.00";

    const handleSubscribe = async () => {
        setLoading(true);

        // Direct Purchase (Anonymous / RevenueCat Managed)
        if (monthlyPackage) {
            const result = await purchasePackage(monthlyPackage);
            if (result.success) {
                onSuccess();
                onClose(); // Close on success
            }
        } else {
            alert("Configuration Error: No Package Found");
        }
        setLoading(false);
    };

    const handleRestore = async () => {
        setLoading(true);
        const success = await restorePurchases();
        if (success) {
            onSuccess();
            onClose();
        }
        setLoading(false);
    }

    return (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

            {/* Sheet */}
            <div className="relative bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-6 pt-10 pb-12 animate-in slide-in-from-bottom duration-300">

                {/* Restore Button (Top Left) */}
                <button
                    onClick={handleRestore}
                    className="absolute top-4 left-4 text-xs text-zinc-500 font-medium hover:text-white"
                >
                    Restore Purchase
                </button>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col items-center text-center space-y-6">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <span className="text-3xl">💎</span>
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold text-white">解锁无限阅读</h2>
                        <p className="text-zinc-400 text-sm max-w-[260px] mx-auto">
                            打破每日3篇限制，获取无尽的硬核英语资源。
                        </p>
                    </div>

                    <div className="w-full max-w-sm bg-zinc-800/50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                            <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-500"><Check className="w-3 h-3" /></div>
                            <span>无限查看原文 & 逐句精听</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                            <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-500"><Check className="w-3 h-3" /></div>
                            <span>解锁全部高级词典与语法分析</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                            <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-500"><Check className="w-3 h-3" /></div>
                            <span>支持独立开发者持续更新</span>
                        </div>
                    </div>

                    <button
                        onClick={handleSubscribe}
                        disabled={loading || !monthlyPackage}
                        className="w-full max-w-sm h-14 bg-white text-black font-bold text-lg rounded-full active:scale-95 transition disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center"
                    >
                        {loading
                            ? <Loader2 className="w-5 h-5 animate-spin" />
                            : !isReady
                                ? "Loading..."
                                : `立即订阅 - ${priceString}/月`
                        }
                    </button>

                    <p className="text-xs text-zinc-600">
                        订阅自动续费，可随时在 Apple ID 设置中取消。
                    </p>
                </div>
            </div>
        </div>
    );
}
