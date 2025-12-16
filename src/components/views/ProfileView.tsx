import { ChevronLeft, RotateCcw, ShieldCheck } from "lucide-react";
import { useRevenueCat } from "@/hooks/useRevenueCat";

interface ProfileViewProps {
    onBack: () => void;
}

export function ProfileView({ onBack }: ProfileViewProps) {
    const { isVip, restorePurchases } = useRevenueCat();

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

                    <div className="text-center">
                        <h2 className="text-xl font-bold">Subscription Status</h2>
                        {isVip ? (
                            <span className="inline-block mt-2 px-3 py-1 bg-amber-500/20 text-amber-500 text-xs font-bold rounded-full border border-amber-500/50">
                                HARDCORE VIP
                            </span>
                        ) : (
                            <span className="inline-block mt-2 px-3 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-full">
                                Free User
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="space-y-4">
                    <button
                        onClick={restorePurchases}
                        className="w-full h-12 bg-zinc-900 border border-zinc-800 text-white font-medium rounded-lg flex items-center justify-center gap-2 active:scale-95 transition hover:bg-zinc-800"
                    >
                        <RotateCcw className="w-5 h-5" />
                        Restore Purchases
                    </button>

                    <div className="text-center text-xs text-zinc-600 pt-4">
                        <p>User ID: Anonymous (RevenueCat)</p>
                    </div>
                </div>

            </div>
        </div>
    );
}

