import { useState, useEffect } from 'react';
import { Settings, ArrowRight, ChevronRight, Sparkles, BookOpen, LayoutGrid } from 'lucide-react';
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
    onSettingsClick
}: CategoryDrawerProps) {
    const [topics, setTopics] = useState<Record<string, Topic[]>>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            loadTopics();
        }
    }, [isOpen]);

    const loadTopics = async () => {
        setIsLoading(true);
        const allTopics = await getAllTopics();
        setTopics(allTopics);
        setIsLoading(false);
    };

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
                        icon={<Sparkles strokeWidth={1.5} size={16} />}
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
                        icon={<BookOpen strokeWidth={1.5} size={16} />}
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
                                        onTopicSelect('core_library', topic.name);
                                        onClose();
                                    }}
                                    defaultIcon={<BookOpen size={16} className="text-emerald-400/70" />}
                                />
                            ))
                        )}
                    </LiquidAccordion>
                </div>

                {/* Footer - Modified: Centered & Larger Settings Button */}
                <div className="p-6 border-t border-white/5 bg-white/5 relative shrink-0">
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none"></div>

                    <div className="flex justify-center relative z-10">
                        <button
                            onClick={onSettingsClick}
                            className="w-2/3 bg-black/40 hover:bg-white/10 rounded-2xl py-3.5 flex items-center justify-center gap-3 border border-white/5 shadow-2xl backdrop-blur-md transition-all active:scale-95 group"
                        >
                            <Settings className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                            <span className="text-sm font-medium text-zinc-400 group-hover:text-white transition-colors">Settings</span>
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}


// --- Sub Components ---

interface LiquidAccordionProps {
    title: string;
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
                        "w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/5 shadow-inner",
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

            {/* Count / Locked Indicator */}
            {isLocked ? (
                <span className="text-[10px] text-zinc-600 border border-zinc-800 px-1.5 py-0.5 rounded">Soon</span>
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
