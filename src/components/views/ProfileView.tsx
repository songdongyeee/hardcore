import { ChevronLeft, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { deleteUserData, pb } from "@/lib/api";
import { useEffect, useState } from "react";
import { Paywall } from "@/components/Paywall";

interface ProfileViewProps {
    onBack: () => void;
}

export function ProfileView({ onBack }: ProfileViewProps) {
    const { isVip, restorePurchases, subscriptionTier, isReady } = useRevenueCat();
    const [pbUserId, setPbUserId] = useState<string>(
        pb.authStore.isValid && pb.authStore.model?.id ? pb.authStore.model.id : 'Loading...'
    );
    const [pbSubscriptionTier, setPbSubscriptionTier] = useState<'free' | 'monthly' | 'quarterly' | 'yearly'>(() => {
        if (pb.authStore.isValid && pb.authStore.model?.subscription_tier) {
            return pb.authStore.model.subscription_tier;
        }
        return 'free';
    });
    const [showPaywall, setShowPaywall] = useState(false);

    // Debug: Log subscription status
    useEffect(() => {
        console.log('[ProfileView] RevenueCat Status:', {
            isReady,
            subscriptionTier,
            isVip
        });
    }, [isReady, subscriptionTier, isVip]);


    // Helper function to fetch subscription tier from PocketBase
    const fetchSubscriptionTier = () => {
        if (pb.authStore.isValid && pb.authStore.model?.id) {
            setPbUserId(pb.authStore.model.id);

            pb.collection('users').getOne(pb.authStore.model.id)
                .then(user => {
                    const tier = user.subscription_tier || 'free';
                    setPbSubscriptionTier(tier);
                    console.log('[ProfileView] PocketBase subscription_tier:', tier);
                })
                .catch(err => {
                    console.error('Failed to fetch user subscription tier:', err);
                });
        } else {
            setPbUserId('Not logged in');
        }
    };

    // Fetch subscription tier from PocketBase
    useEffect(() => {
        fetchSubscriptionTier();
    }, []);

    // Re-fetch when RevenueCat becomes ready (one-time after initialization)
    useEffect(() => {
        if (isReady) {
            // Small delay to allow backend sync to complete
            const timer = setTimeout(() => {
                fetchSubscriptionTier();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isReady]); // Only depend on isReady, not subscriptionTier


    return (
        <div className="fixed inset-0 z-50 bg-black text-white flex flex-col pt-[env(safe-area-inset-top)]">
            {/* Header */}
            <div className="h-14 flex items-center px-4 border-b border-zinc-900">
                <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white">
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <h1 className="text-lg font-bold ml-2">Settings</h1>
            </div>

            <div className="flex-1 p-6 space-y-8">
                {/* Identity Card */}
                <div className="flex flex-col items-center space-y-4 py-8">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl border-4 ${isVip ? 'border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                        <ShieldCheck className="w-10 h-10" />
                    </div>

                    <div className="text-center cursor-pointer" onClick={() => setShowPaywall(true)}>
                        <h2 className="text-xl font-bold hover:text-indigo-400 transition-colors">Subscription Status</h2>
                        {pbSubscriptionTier === 'free' ? (
                            <span className="inline-block mt-2 px-3 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-full hover:bg-zinc-700 transition-colors">
                                Free User
                            </span>
                        ) : pbSubscriptionTier === 'monthly' ? (
                            <span className="inline-block mt-2 px-3 py-1 bg-indigo-500/20 text-indigo-400 text-xs font-bold rounded-full border border-indigo-500/50 hover:bg-indigo-500/30 transition-colors">
                                月度会员
                            </span>
                        ) : pbSubscriptionTier === 'quarterly' ? (
                            <span className="inline-block mt-2 px-3 py-1 bg-purple-500/20 text-purple-400 text-xs font-bold rounded-full border border-purple-500/50 hover:bg-purple-500/30 transition-colors">
                                季度会员
                            </span>
                        ) : (
                            <span className="inline-block mt-2 px-3 py-1 bg-amber-500/20 text-amber-500 text-xs font-bold rounded-full border border-amber-500/50 hover:bg-amber-500/30 transition-colors">
                                年度会员 · VIP
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="space-y-4">
                    <button
                        onClick={async () => {
                            await restorePurchases();
                            // Refresh subscription tier after restore (successful or not)
                            // Small delay to ensure PocketBase sync completes
                            setTimeout(() => {
                                fetchSubscriptionTier();
                            }, 1000);
                        }}
                        className="w-full h-12 bg-zinc-900 border border-zinc-800 text-white font-medium rounded-lg flex items-center justify-center gap-2 active:scale-95 transition hover:bg-zinc-800"
                    >
                        <RotateCcw className="w-5 h-5" />
                        恢复购买
                    </button>

                    <div className="text-center text-xs text-zinc-600 pt-4 space-y-2">
                        <p>User ID: {pbUserId}</p>
                        <button
                            onClick={async () => {
                                if (confirm("危险操作：这将永久删除您的所有学习数据、关注的材料以及用户账号。此操作不可撤销。\n\n确定要继续吗？")) {
                                    await deleteUserData();
                                    alert("您的数据已被删除。应用将重启。");
                                    window.location.reload();
                                }
                            }}
                            className="text-red-900 hover:text-red-700 flex items-center justify-center gap-1 mx-auto"
                        >
                            <Trash2 className="w-3 h-3" />
                            Delete Account & Data
                        </button>
                    </div>
                </div>

            </div>

            {/* Paywall Modal */}
            <Paywall
                isOpen={showPaywall}
                onClose={() => setShowPaywall(false)}
                onSuccess={() => {
                    setShowPaywall(false);
                    // Optionally refresh subscription status
                }}
            />
        </div>
    );
}

