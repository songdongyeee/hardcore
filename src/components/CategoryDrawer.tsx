import { useState, useEffect } from 'react';
import { Settings, ArrowRight, ChevronRight, Sparkles, BookOpen, LayoutGrid, Crown } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getAllTopics, type Topic } from '@/lib/topicService';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// NOTE: User environment might not have @iconify/react installed. Reference HTML used CDN.
// I will stick to lucide-react and standard HTML/CSS as much as possible, or simple Emoji.
// Reference used <iconify-icon>.
// I'll use Lucide icons to be safe with existing dependencies, but style them carefully.

interface CategoryDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onTopicSelect: (category: string | null, topicName: string | null) => void;
    currentTopic?: string;
    onSettingsClick: () => void;
    onUpgradeClick?: () => void; // Optional callback
    subscriptionTier?: 'free' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime';
}

// 🎯 Helper: Extract Emoji from string
const extractEmoji = (text: string): { icon: string | null; label: string } => {
    // Regex to match the *first* emoji at the start of the string
    // This is a simple approximation. For robust emoji detection we'd need a larger regex.
    const emojiRegex = /^(\p{Extended_Pictographic})/u;
    const match = text.match(emojiRegex);

    if (match) {
        return {
            icon: match[0],
            label: text.replace(match[0], '').trim()
        };
    }
    return { icon: null, label: text };
};

export function CategoryDrawer({
    isOpen,
    onClose,
    onTopicSelect,
    currentTopic,
    onSettingsClick,
    onUpgradeClick,
    subscriptionTier = 'free'
}: CategoryDrawerProps) {
    const [topics, setTopics] = useState<Record<string, Topic[]>>({});
    const [isLoading, setIsLoading] = useState(true);

    // 🚀 Prefetch: App启动/组件挂载时立即默默加载
    useEffect(() => {
        loadTopics({ isSilent: false }); // 首次加载（用户不可见，但如果打开得快可能看到Loading）
    }, []);

    // 🔄 Revalidate: 每次打开抽屉时静默刷新
    useEffect(() => {
        if (isOpen) {
            // 如果内存里已经有数据了，就不要显示Loading，悄悄更新即可
            const hasData = Object.keys(topics).length > 0;
            loadTopics({ isSilent: hasData });
        }
    }, [isOpen]);

    const loadTopics = async (options: { isSilent: boolean } = { isSilent: false }) => {
        // 只有非静默模式下（且依然需要Loading时）才转圈圈
        if (!options.isSilent) {
            setIsLoading(true);
        }

        try {
            const allTopics = await getAllTopics();
            setTopics(allTopics);
        } catch (error) {
            console.error('❌ [Drawer] Failed to load topics', error);
        } finally {
            if (!options.isSilent) {
                setIsLoading(false);
            }
        }
    };

    // 🎯 Logic for Dynamic Badge
    const getBadgeConfig = () => {
        // 🔥 Always open Paywall (Upgrade/Manage) regardless of tier
        const commonAction = onUpgradeClick;

        switch (subscriptionTier) {
            case 'monthly':
                return {
                    text: '月度会员',
                    bgGradient: 'from-indigo-500/20 to-blue-600/20',
                    hoverGradient: 'hover:from-indigo-500/30 hover:to-blue-600/30',
                    borderColor: 'border-indigo-500/20',
                    iconColor: 'text-indigo-400',
                    textColor: 'text-indigo-200/90',
                    slideBg: 'bg-indigo-400/5 group-hover:bg-indigo-400/10',
                    onClick: commonAction
                };
            case 'quarterly':
                return {
                    text: '季度会员',
                    bgGradient: 'from-purple-500/20 to-pink-600/20',
                    hoverGradient: 'hover:from-purple-500/30 hover:to-pink-600/30',
                    borderColor: 'border-purple-500/20',
                    iconColor: 'text-purple-400',
                    textColor: 'text-purple-200/90',
                    slideBg: 'bg-purple-400/5 group-hover:bg-purple-400/10',
                    onClick: commonAction
                };
            case 'yearly':
                return {
                    text: '年度会员 · VIP',
                    bgGradient: 'from-amber-500/20 to-orange-600/20',
                    hoverGradient: 'hover:from-amber-500/30 hover:to-orange-600/30',
                    borderColor: 'border-amber-500/20',
                    iconColor: 'text-amber-400',
                    textColor: 'text-amber-200/90',
                    slideBg: 'bg-amber-400/5 group-hover:bg-amber-400/10',
                    onClick: commonAction
                };
            case 'lifetime':
                return {
                    text: '终身会员 · Pro',
                    bgGradient: 'from-indigo-500/20 to-purple-600/20',
                    hoverGradient: 'hover:from-indigo-500/30 hover:to-purple-600/30',
                    borderColor: 'border-indigo-500/50',
                    iconColor: 'text-indigo-400',
                    textColor: 'text-indigo-200/90',
                    slideBg: 'bg-indigo-400/5 group-hover:bg-indigo-400/10',
                    onClick: commonAction
                };
            default: // free
                return {
                    text: '升级Pro会员',
                    bgGradient: 'from-amber-500/20 to-orange-600/20',
                    hoverGradient: 'hover:from-amber-500/30 hover:to-orange-600/30',
                    borderColor: 'border-amber-500/20',
                    iconColor: 'text-amber-400',
                    textColor: 'text-amber-200/90',
                    slideBg: 'bg-amber-400/5 group-hover:bg-amber-400/10',
                    onClick: commonAction
                };
        }
    };

    const badge = getBadgeConfig();

    // 🎯 Liquid Glass Drawer with Swipe-to-Close
    return (
        <div className={cn("fixed inset-0 z-[100] transition-opacity duration-700", isOpen ? "pointer-events-auto" : "pointer-events-none")}>
            {/* Backdrop - Swipeable */}
            <motion.div
                className={cn(
                    "absolute inset-0 bg-[#000000]/40 backdrop-blur-[2px] transition-opacity duration-700",
                    isOpen ? "opacity-100" : "opacity-0"
                )}
                onClick={onClose}
                onPan={() => { }} // Dummy handler to ensure onPanEnd fires reliably
                onPanEnd={(_, info) => {
                    // Swipe right on backdrop to close (if velocity > 0 and offset > 50)
                    if (info.offset.x > 50 && info.velocity.x > 0) {
                        onClose();
                    }
                }}
            />

            {/* Drawer Panel - Swipeable */}
            <motion.div
                initial={{ x: "100%" }}
                animate={{ x: isOpen ? "0%" : "100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                drag="x"
                dragConstraints={{ left: 0 }} // Prevent dragging left beyond screen
                dragElastic={{ left: 0, right: 0.5 }}
                dragDirectionLock={true} // 🔒 Lock direction to prevent accidental closes when scrolling vertically
                dragSnapToOrigin={true} // 🔒 Snap back to open position if not closed
                onDragEnd={(_, info) => {
                    // Close if dragged more than 100px or flicked quickly to the right
                    if (info.offset.x > 100 || info.velocity.x > 500) {
                        onClose();
                    }
                }}
                className="fixed top-0 right-0 h-full w-[85%] max-w-[340px] liquid-drawer z-50 flex flex-col"
            >
                {/* Visual "Handle" for hint (Optional, but good for UX) - placed at left edge */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-2 pointer-events-none opacity-0">
                    {/* Could add a visual handle here if needed */}
                </div>

                {/* Content - Safe Area Adapted */}
                <div className="flex-1 overflow-y-auto p-4 pt-[calc(env(safe-area-inset-top)+2rem)] space-y-2 no-scrollbar relative touch-pan-y">

                    {/* ALL MATERIALS */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            console.log('🖱️ [Drawer] Clicked "All Materials"');

                            // 🔥 Non-blocking haptics
                            Haptics.impact({ style: ImpactStyle.Medium }).catch(err =>
                                console.warn('⚠️ Haptics failed', err)
                            );

                            // 🔥 CRITICAL: Update state BEFORE closing to prevent race conditions
                            console.log('🔄 [Drawer] Triggering reset: onTopicSelect(null, null)');
                            onTopicSelect(null, null); // Clear filters

                            // Close AFTER state update trigger
                            onClose();
                        }}
                        className="w-full flex items-center justify-between p-4 rounded-2xl glass-button text-left group mb-6 relative overflow-hidden z-50"
                    >
                        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors duration-500"></div>
                        <div className="flex items-center gap-3 relative z-10">
                            <div className="text-zinc-400 group-hover:text-white transition-colors">
                                <LayoutGrid strokeWidth={1.5} size={20} />
                            </div>
                            <span className="text-base font-medium text-zinc-200 group-hover:text-white">All Materials</span>
                        </div>
                        <ArrowRight className="relative z-10 text-zinc-600 group-hover:text-white transition-colors" size={18} />
                    </button>

                    {/* DAILY SPARK SECTION */}
                    <LiquidAccordion
                        title="Daily Spark"
                        icon={
                            <div className="flex items-center gap-1.5">
                                <Sparkles strokeWidth={1.5} size={14} />
                                <span className="text-[10px] font-bold tracking-wide opacity-90">切片</span>
                            </div>
                        }
                        iconColorClass="text-indigo-400"
                        defaultOpen={true}
                    >
                        {isLoading ? (
                            <div className="py-2 text-zinc-500 text-xs px-2">Loading...</div>
                        ) : (
                            topics.daily_spark?.map(topic => (
                                <TopicItem
                                    key={topic.name}
                                    topic={topic}
                                    isActive={currentTopic === topic.name}
                                    onClick={() => {
                                        console.log(`🖱️ [Drawer] Selected Topic: daily_spark/${topic.name}`);
                                        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => { });
                                        onTopicSelect('daily_spark', topic.name);
                                        onClose();
                                    }}
                                    defaultIcon={<Sparkles size={16} className="text-indigo-400/70" />}
                                />
                            ))
                        )}
                    </LiquidAccordion>

                    <div className="h-4"></div>

                    {/* CORE LIBRARY SECTION */}
                    <LiquidAccordion
                        title="Core Library"
                        icon={
                            <div className="flex items-center gap-1.5">
                                <BookOpen strokeWidth={1.5} size={14} />
                                <span className="text-[10px] font-bold tracking-wide opacity-90">整篇</span>
                            </div>
                        }
                        iconColorClass="text-emerald-400"
                        defaultOpen={true}
                    >
                        {isLoading ? (
                            <div className="py-2 text-zinc-500 text-xs px-2">Loading...</div>
                        ) : (
                            topics.core_library?.map(topic => (
                                <TopicItem
                                    key={topic.name}
                                    topic={topic}
                                    isActive={currentTopic === topic.name}
                                    onClick={() => {
                                        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => { });
                                        onTopicSelect('core_library', topic.name);
                                        onClose();
                                    }}
                                    defaultIcon={<BookOpen size={16} className="text-emerald-400/70" />}
                                />
                            ))
                        )}
                    </LiquidAccordion>
                </div>

                {/* Footer - Modified: Side-by-side Pro & Settings (More Spacing, Narrower) */}
                <div className="px-8 py-6 border-t border-white/5 bg-white/5 relative shrink-0">
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none"></div>

                    <div className="flex gap-4 relative z-10 w-full">
                        {/* Dynamic Badge Button (Compact) */}
                        <button
                            onClick={badge.onClick}
                            className={cn(
                                "flex-1 rounded-xl py-2.5 flex items-center justify-center gap-1.5 border shadow-lg backdrop-blur-md transition-all active:scale-95 group relative overflow-hidden",
                                `bg-gradient-to-br ${badge.bgGradient} ${badge.hoverGradient} ${badge.borderColor}`
                            )}
                        >
                            <div className={cn("absolute inset-0 transition-colors", badge.slideBg)}></div>
                            <Crown className={cn("w-4 h-4 transition-colors", badge.iconColor)} fill="currentColor" fillOpacity={0.2} />
                            <span className={cn("text-xs font-bold transition-colors group-hover:text-white", badge.textColor)}>
                                {badge.text}
                            </span>
                        </button>

                        {/* Settings Button - Standard Style (Compact) */}
                        <button
                            onClick={onSettingsClick}
                            className="flex-1 bg-white/5 hover:bg-white/10 rounded-xl py-2.5 flex items-center justify-center gap-1.5 border border-white/20 shadow-lg backdrop-blur-md transition-all active:scale-95 group"
                        >
                            <Settings className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
                            <span className="text-xs font-medium text-zinc-400 group-hover:text-white transition-colors">设置</span>
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}


// --- Sub Components ---

interface LiquidAccordionProps {
    title: React.ReactNode; // 🎯 Changed from string to ReactNode to support badges
    icon: React.ReactNode;
    iconColorClass: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

function LiquidAccordion({ title, icon, iconColorClass, children, defaultOpen = false }: LiquidAccordionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="space-y-1">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/10 transition-colors group"
            >
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "h-8 min-w-[2rem] px-2.5 rounded-lg flex items-center justify-center bg-white/5 border border-white/5 shadow-inner transition-all", // 🎯 Changed: Flexible width for icon+badge
                        iconColorClass
                    )}>
                        {icon}
                    </div>
                    <span className="text-lg font-medium text-white/90">{title}</span>
                </div>
                <div className={cn("text-zinc-500 transition-transform duration-300", isOpen ? "rotate-0" : "-rotate-90")}>
                    <ChevronRight size={16} className="rotate-90" /> {/* ChevronDown equiv when rotated */}
                </div>
            </button>

            <motion.div
                initial={false}
                animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.4, ease: [0.33, 1, 0.68, 1] }}
                className="overflow-hidden"
            >
                <div className="pl-4 border-l border-white/5 ml-7 space-y-1 pb-2">
                    {children}
                </div>
            </motion.div>
        </div>
    );
}

interface TopicItemProps {
    topic: Topic;
    isActive: boolean;
    onClick: () => void;
    defaultIcon: React.ReactNode;
}

function TopicItem({ topic, isActive, onClick, defaultIcon }: TopicItemProps) {
    const { icon, label } = extractEmoji(topic.name);
    const isLocked = topic.status === 'locked' || topic.status === 'coming_soon';

    return (
        <button
            onClick={!isLocked ? onClick : undefined}
            disabled={isLocked}
            className={cn(
                "w-full flex items-center gap-3 py-3 px-3 rounded-lg text-left group transition-all duration-300 touch-pan-y select-none",
                isActive ? "bg-white/10" : "hover:bg-white/5",
                isLocked && "opacity-50 cursor-not-allowed"
            )}
        >
            {/* Icon Area */}
            <div className={cn(
                "flex-shrink-0 transition-transform duration-300",
                isActive ? "scale-110" : "group-hover:scale-110"
            )}>
                {icon ? (
                    <span className="text-base leading-none filter drop-shadow-lg">{icon}</span>
                ) : (
                    <div className={cn("text-zinc-500 transition-colors", isActive ? "text-white" : "group-hover:text-white")}>
                        {defaultIcon}
                    </div>
                )}
            </div>

            {/* Label Area */}
            <div className="flex-1 min-w-0">
                <span className={cn(
                    "text-base transition-all duration-300 truncate block",
                    isActive ? "text-zinc-100 translate-x-1" : "text-zinc-400 group-hover:text-zinc-100 group-hover:translate-x-1"
                )}>
                    {label}
                </span>
            </div>

            {isLocked ? (
                <span className="text-[10px] font-medium text-zinc-400 bg-zinc-800/50 border border-zinc-700/50 px-2 py-0.5 rounded-md">
                    {topic.comingSoonLabel || 'Soon'}
                </span>
            ) : (
                <span className={cn(
                    "text-xs transition-colors",
                    isActive ? "text-zinc-400" : "text-zinc-600 group-hover:text-zinc-500"
                )}>
                    {topic.count}
                </span>
            )}
        </button>
    );
}
