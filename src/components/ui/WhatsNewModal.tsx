import { useState, useEffect } from 'react';
import { Sparkles, Zap, Bell, X, Check } from 'lucide-react';
import { cn } from "@/lib/utils";
import { RELEASE_NOTES } from "@/data/releaseNotes";

interface WhatsNewModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const iconMap: Record<string, any> = {
    sparkles: Sparkles,
    zap: Zap,
    bell: Bell,
};

export function WhatsNewModal({ isOpen, onClose }: WhatsNewModalProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            // 🔥 微延时触发入场动画
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
            const timer = setTimeout(() => setShouldRender(false), 400);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!shouldRender) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center px-4 overflow-hidden pointer-events-none">
            {/* 🌑 黑色遮罩层 */}
            <div
                className={cn(
                    "absolute inset-0 bg-black/60 transition-opacity duration-500 ease-out pointer-events-auto",
                    isVisible ? "opacity-100" : "opacity-0"
                )}
                onClick={onClose}
            />

            {/* 📦 弹窗主体 */}
            <div
                className={cn(
                    "relative w-full max-w-lg bg-zinc-950/80 backdrop-blur-2xl border border-zinc-800 rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.2,1,0.3,1)] pointer-events-auto",
                    isVisible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 sm:translate-y-8"
                )}
            >
                {/* 顶部装饰条 */}
                <div className="sm:hidden w-12 h-1.5 bg-zinc-800/80 rounded-full mx-auto mt-4 mb-2" />

                <div className="px-8 pt-8 pb-10">
                    {/* 标题 */}
                    <div className="flex justify-between items-start mb-10">
                        <div>
                            <h2 className="text-3xl font-bold text-white tracking-tight mb-2">
                                {RELEASE_NOTES.title}
                            </h2>
                            <div className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold border border-indigo-500/20">
                                v{RELEASE_NOTES.version}
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 -mt-1 -mr-2 text-zinc-500 hover:text-white transition-colors"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    {/* 功能点列表 */}
                    <div className="space-y-8">
                        {RELEASE_NOTES.features.map((feature, idx) => {
                            const Icon = iconMap[feature.icon] || Sparkles;
                            return (
                                <div key={idx} className="flex gap-5 group items-center">
                                    <div className="shrink-0 w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-indigo-400 shadow-inner group-hover:scale-110 transition-transform duration-300">
                                        <Icon className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-lg font-semibold text-zinc-100 mb-1 leading-none">{feature.title}</h3>
                                        <p className="text-sm text-zinc-500 leading-relaxed font-medium">
                                            {feature.description}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 底部确认按钮 */}
                    <div className="mt-12">
                        <button
                            onClick={onClose}
                            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-lg hover:bg-zinc-200 active:scale-[0.98] transition-all shadow-[0_8px_30px_rgb(0,0,0,0.4)] flex items-center justify-center gap-2"
                        >
                            <span>立即体验</span>
                            <Check className="w-5 h-5 pointer-events-none" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
