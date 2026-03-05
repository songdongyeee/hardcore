import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, HelpCircle } from "lucide-react";
import { Preferences } from "@capacitor/preferences";


interface StepGuideModalProps {
    stepKey: string;
    title: string;
    description: React.ReactNode;
}

export function StepGuideModal({ stepKey, title, description }: StepGuideModalProps) {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        async function checkFirstVisit() {
            const prefKey = `has_seen_guide_${stepKey}`;
            const { value } = await Preferences.get({ key: prefKey });

            if (!value) {
                setIsOpen(true);
                await Preferences.set({ key: prefKey, value: "true" });
            }
        }
        checkFirstVisit();
    }, [stepKey]);

    return (
        <>
            {/* 🚀 Manual Trigger Button (placed in the top right typically) */}
            <button
                onClick={() => setIsOpen(true)}
                className="p-2 mr-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors active:scale-95 z-50 relative shrink-0"
                title="学习指南"
            >
                <HelpCircle size={20} className="opacity-80" />
            </button>

            {/* 🔮 Elegant Modal Overlay rendered into the body */}
            {isOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-md"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-700/50 shadow-2xl rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center transform animate-in fade-in zoom-in duration-300">
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors active:scale-95"
                        >
                            <X size={18} />
                        </button>
                        <div className="w-16 h-16 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mb-6 border border-white/5">
                            <HelpCircle className="text-indigo-400" size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-4 tracking-wide">{title}</h3>
                        <div className="text-zinc-300 text-[15px] leading-relaxed mb-8 self-stretch">
                            {description}
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="w-full py-3.5 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
                        >
                            我知道了
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
