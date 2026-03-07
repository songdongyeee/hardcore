import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { X, HelpCircle } from "lucide-react";
import { Preferences } from "@capacitor/preferences";

interface StepGuideModalProps {
    stepKey: string;
    title: string;
    description: React.ReactNode;
    onOpen?: () => void;
    onClose?: () => void;
}

export function StepGuideModal({ stepKey, title, description, onOpen, onClose }: StepGuideModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, arrowX: 0 });

    useEffect(() => {
        async function checkFirstVisit() {
            // 使用 v4 确保这次更新后能看到新的气泡效果与播放逻辑
            const prefKey = `has_seen_guide_v4_${stepKey}`;
            const { value } = await Preferences.get({ key: prefKey });

            if (!value) {
                // 稍微延迟弹出，感官更顺滑
                setTimeout(() => {
                    setIsOpen(true);
                    onOpen?.(); // 触发打开回调，用于暂停音频
                }, 800);
                await Preferences.set({ key: prefKey, value: "true" });
            }
        }
        checkFirstVisit();
    }, [stepKey, onOpen]);

    // 计算弹窗位置
    useEffect(() => {
        if (isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const popoverWidth = Math.min(screenWidth * 0.9, 340);

            let left = rect.left + rect.width / 2 - popoverWidth / 2;
            let arrowX = popoverWidth / 2;

            if (left + popoverWidth > screenWidth - 16) {
                left = screenWidth - popoverWidth - 16;
                arrowX = rect.left + rect.width / 2 - left;
            }
            if (left < 16) {
                left = 16;
                arrowX = rect.left + rect.width / 2 - left;
            }

            setPopoverPos({
                top: rect.bottom + 14,
                left,
                arrowX
            });
        }
    }, [isOpen]);

    const handleClose = () => {
        setIsOpen(false);
        onClose?.(); // 确保任何方式关闭都会触发回调
    };

    return (
        <>
            <button
                ref={triggerRef}
                onClick={() => {
                    setIsOpen(true);
                    onOpen?.(); // 手动打开也暂停音频
                }}
                className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors active:scale-95 z-50 relative shrink-0"
                title="学习指南"
            >
                <HelpCircle size={22} className="opacity-80" />
            </button>

            {isOpen && createPortal(
                <div className="fixed inset-0 z-[10000]">
                    {/* 点击背景关闭 */}
                    <div
                        className="absolute inset-0 bg-black/10 backdrop-blur-[2px]"
                        onClick={handleClose}
                    />

                    {/* 气泡本体 */}
                    <div
                        className="absolute animate-in fade-in zoom-in-95 duration-250 ease-out"
                        style={{
                            top: `${popoverPos.top}px`,
                            left: `${popoverPos.left}px`,
                            width: `calc(100vw - 32px)`,
                            maxWidth: '340px'
                        }}
                    >
                        {/* 箭头指向 - 增加微弱光边 */}
                        <div
                            className="absolute -top-1.5 w-3.5 h-3.5 bg-[#1c1c1f] border-l border-t border-white/20 rotate-45 z-10"
                            style={{ left: `${popoverPos.arrowX - 7}px` }}
                        />

                        {/* 气泡外框 - 增强阴影与光晕 */}
                        <div className="relative bg-[#1c1c1f]/95 backdrop-blur-3xl border border-white/20 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7),0_0_20px_rgba(255,255,255,0.03)] rounded-[2.2rem] p-7 sm:p-9 flex flex-col items-start text-left overflow-hidden ring-1 ring-black/80">
                            {/* 关闭叉号 */}
                            <button
                                onClick={handleClose}
                                className="absolute top-5 right-5 p-1.5 text-zinc-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors"
                            >
                                <X size={16} />
                            </button>

                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-indigo-500/25 flex items-center justify-center shadow-inner">
                                    <HelpCircle size={20} className="text-indigo-400" />
                                </div>
                                {title}
                            </h3>

                            <div className="text-zinc-300 text-[16px] leading-relaxed mb-10 self-stretch space-y-4 font-medium tracking-tight">
                                {description}
                            </div>

                            <button
                                onClick={handleClose}
                                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white text-sm font-bold rounded-2xl hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] active:scale-[0.97] transition-all shadow-lg shadow-indigo-500/10 border border-white/10"
                            >
                                我知道了
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
