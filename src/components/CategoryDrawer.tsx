import { useState, useEffect } from 'react';
import * as React from 'react';
import { X, Sparkles, Library, Settings, ChevronDown, Folder, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getAllTopics, type Topic } from '@/lib/topicService';

// ==================== 主组件 ====================

interface CategoryDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onTopicSelect: (category: string, topicName: string) => void;
    currentTopic?: string;
    onSettingsClick: () => void;
}

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

    console.log('CategoryDrawer rendering, isOpen:', isOpen);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="relative w-80 bg-zinc-950 h-full shadow-2xl flex flex-col border-l border-white/10 animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-b from-zinc-950 to-zinc-950/95 backdrop-blur-xl border-b border-white/5 px-6 py-4 z-10">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <span className="text-2xl">📚</span>
                            <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                                材料库
                            </span>
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-zinc-400" />
                        </button>
                    </div>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
                        </div>
                    ) : (
                        <>
                            <CategorySection
                                category={{ id: 'daily_spark', name: 'Daily Spark', icon: Sparkles }}
                                topics={topics.daily_spark || []}
                                onTopicSelect={onTopicSelect}
                                currentTopic={currentTopic}
                            />
                            <CategorySection
                                category={{ id: 'core_library', name: 'Core Library', icon: Library }}
                                topics={topics.core_library || []}
                                onTopicSelect={onTopicSelect}
                                currentTopic={currentTopic}
                            />
                        </>
                    )}
                </div>

                {/* Footer - Settings */}
                <div className="sticky bottom-0 bg-gradient-to-t from-zinc-950 to-zinc-950/95 backdrop-blur-xl border-t border-white/5 p-4">
                    <button
                        onClick={onSettingsClick}
                        className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition-all duration-200 group"
                    >
                        <Settings className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                        <span className="font-medium text-zinc-300 group-hover:text-white transition-colors">
                            设置
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// ==================== CategorySection ====================

interface CategorySectionProps {
    category: {
        id: string;
        name: string;
        icon: React.ComponentType<{ className?: string }>;
    };
    topics: Topic[];
    onTopicSelect: (category: string, topicName: string) => void;
    currentTopic?: string;
}

function CategorySection({ category, topics, onTopicSelect, currentTopic }: CategorySectionProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="space-y-2">
            {/* Category Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full group"
            >
                <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2">
                        <category.icon className="w-5 h-5 text-blue-400" />
                        <span className="font-semibold text-white text-sm tracking-wide">
                            {category.name}
                        </span>
                    </div>
                    <ChevronDown
                        className={cn(
                            "w-4 h-4 text-zinc-500 transition-transform duration-200",
                            isExpanded && "rotate-180"
                        )}
                    />
                </div>
            </button>

            {/* Topics List */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="ml-7 space-y-1">
                            {topics.map((topic, index) => (
                                <motion.div
                                    key={topic.name}
                                    initial={{ x: -20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    transition={{ delay: index * 0.05 }}
                                >
                                    <TopicItem
                                        topic={topic}
                                        isActive={currentTopic === topic.name}
                                        onClick={() => onTopicSelect(category.id, topic.name)}
                                    />
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ==================== TopicItem ====================

interface TopicItemProps {
    topic: Topic;
    isActive: boolean;
    onClick: () => void;
}

function TopicItem({ topic, isActive, onClick }: TopicItemProps) {
    const isLocked = topic.status === 'coming_soon' || topic.status === 'locked';
    const comingSoonLabel = topic.comingSoonLabel || '即将开放';

    const handleClick = () => {
        if (isLocked) {
            // 可选：显示toast提示
            // toast.info(comingSoonLabel);
            return;
        }
        onClick();
    };

    return (
        <button
            onClick={handleClick}
            disabled={isLocked}
            className={cn(
                "w-full px-3 py-2.5 rounded-lg transition-all duration-200 group relative",
                "flex items-center justify-between",
                isLocked && "cursor-not-allowed opacity-60",
                !isLocked && isActive && "bg-blue-600 text-white shadow-lg shadow-blue-600/20",
                !isLocked && !isActive && "hover:bg-white/5 text-zinc-300"
            )}
        >
            <div className="flex items-center gap-2 min-w-0">
                {isLocked ? (
                    <Lock className="w-4 h-4 flex-shrink-0 text-zinc-500" />
                ) : (
                    <Folder
                        className={cn(
                            "w-4 h-4 flex-shrink-0 transition-colors",
                            isActive ? "text-white" : "text-zinc-500 group-hover:text-zinc-400"
                        )}
                    />
                )}
                <span className={cn(
                    "text-sm font-medium truncate",
                    isActive && !isLocked && "text-white",
                    !isActive && !isLocked && "text-zinc-300",
                    isLocked && "text-zinc-500"
                )}>
                    {topic.name}
                </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {isLocked ? (
                    <span className="text-[10px] px-2 py-0.5 bg-zinc-800 text-zinc-500 rounded-full border border-zinc-700">
                        {comingSoonLabel}
                    </span>
                ) : (
                    <span className={cn(
                        "text-xs",
                        isActive ? "text-blue-200" : "text-zinc-500 group-hover:text-zinc-400"
                    )}>
                        ({topic.count})
                    </span>
                )}
            </div>
        </button>
    );
}
