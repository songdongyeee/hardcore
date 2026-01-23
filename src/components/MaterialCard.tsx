import React, { useState, useRef, useEffect } from "react";
import { Trash2, Edit2, Pin, PinOff, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImpactStyle, Haptics } from "@capacitor/haptics";
import type { Material } from "@/data/types";

export interface MaterialCardProps {
    material: Material;
    isActive: boolean;
    onClick: () => void;
    onDelete?: () => void;
    onRename?: () => void;
    onTogglePin?: () => void;
    onToggleStar?: () => void;
    variant?: 'hero' | 'grid';
    showDailySparkTags?: boolean; // 🎯 NEW: Control special Daily Spark tags
}

export const MaterialCard = React.memo(function MaterialCard({
    material,
    isActive,
    onClick,
    onDelete,
    onRename,
    onTogglePin,
    onToggleStar,
    variant = 'hero',
    showDailySparkTags = false // Default to false
}: MaterialCardProps) {
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    const startXRef = useRef(0);
    const startYRef = useRef(0);
    const isHorizontalSwipeRef = useRef<boolean | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const isGrid = variant === 'grid';
    // Only show rename/delete for materials owned by the user
    const isPrivate = material.visibility === 'private';
    const isPinned = material.userMeta?.isPinned || false;

    // Actions Configuration
    const actions = [
        {
            id: 'pin',
            icon: isPinned ? PinOff : Pin,
            label: isPinned ? 'Unpin' : 'Pin',
            color: 'bg-amber-500',
            onClick: onTogglePin,
            show: true
        },
        ...(isPrivate ? [
            { id: 'rename', icon: Edit2, label: 'Rename', color: 'bg-indigo-500', onClick: onRename, show: true },
            { id: 'delete', icon: Trash2, label: 'Delete', color: 'bg-red-500', onClick: onDelete, show: true }
        ] : [])
    ].filter(a => a.show);

    const actionWidth = 70;
    const maxOffset = actions.length * actionWidth;

    // Manual Event Listeners to support e.preventDefault()
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !isGrid) return;

        const onTouchStart = (e: TouchEvent) => {
            startXRef.current = e.touches[0].clientX;
            startYRef.current = e.touches[0].clientY;
            isHorizontalSwipeRef.current = null;
            setIsSwiping(true);
        };

        const onTouchMove = (e: TouchEvent) => {
            if (isHorizontalSwipeRef.current === false) return;

            const touch = e.touches[0];
            const deltaX = startXRef.current - touch.clientX;
            const deltaY = Math.abs(startYRef.current - touch.clientY);

            // Determine direction if not yet locked
            if (isHorizontalSwipeRef.current === null) {
                if (Math.abs(deltaX) > 10 || deltaY > 10) {
                    if (Math.abs(deltaX) > deltaY) {
                        isHorizontalSwipeRef.current = true;
                    } else {
                        isHorizontalSwipeRef.current = false;
                        setIsSwiping(false);
                        return;
                    }
                } else {
                    return;
                }
            }

            // If it's a horizontal swipe, prevent vertical scrolling
            if (isHorizontalSwipeRef.current) {
                if (e.cancelable) e.preventDefault();

                // Only allow swiping left
                let newOffset = deltaX;
                if (deltaX < 0 && swipeOffset === 0) {
                    newOffset = 0;
                } else if (deltaX > maxOffset) {
                    newOffset = maxOffset + (deltaX - maxOffset) * 0.3;
                }

                setSwipeOffset(newOffset);
            }
        };

        const onTouchEnd = () => {
            setIsSwiping(false);
            if (isHorizontalSwipeRef.current) {
                if (swipeOffset > maxOffset / 2) {
                    setSwipeOffset(maxOffset);
                    Haptics.impact({ style: ImpactStyle.Light });
                } else {
                    setSwipeOffset(0);
                }
            }
            isHorizontalSwipeRef.current = null;
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
        };
    }, [isGrid, swipeOffset, maxOffset]);

    // Reset swipe on click outside
    useEffect(() => {
        if (swipeOffset === 0) return;
        const handleDown = () => setSwipeOffset(0);
        window.addEventListener('mousedown', handleDown);
        return () => window.removeEventListener('mousedown', handleDown);
    }, [swipeOffset]);

    const handleMainClick = (e: React.MouseEvent) => {
        if (swipeOffset !== 0) {
            setSwipeOffset(0);
            e.stopPropagation();
            return;
        }
        onClick();
    };

    const [focusFactor, setFocusFactor] = useState(0);

    // Dynamic Focus Animation via IntersectionObserver
    useEffect(() => {
        if (!containerRef.current || !isGrid) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    // entry.intersectionRatio tells us how much is visible
                    // But for "center" focus, we want to check where it is
                    if (entry.isIntersecting) {
                        // We use a scroll listener to refine the factor based on center position
                        const updateFocus = () => {
                            if (!containerRef.current) return;
                            const rect = containerRef.current.getBoundingClientRect();
                            const viewportHeight = window.innerHeight;
                            const centerOffset = Math.abs((rect.top + rect.height / 2) - viewportHeight / 2);
                            const maxDistance = viewportHeight / 1.5;
                            const factor = Math.max(0, 1 - centerOffset / maxDistance);
                            setFocusFactor(Math.pow(factor, 2)); // Curved for smoother feel
                        };
                        window.addEventListener('scroll', updateFocus, { passive: true });
                        updateFocus();
                        return () => window.removeEventListener('scroll', updateFocus);
                    } else {
                        setFocusFactor(0);
                    }
                });
            },
            { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1.0] }
        );

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [isGrid]);

    return (
        <div
            ref={containerRef}
            style={{
                transform: `scale(${1 + focusFactor * 0.05})`,
                filter: `brightness(${0.85 + focusFactor * 0.15})`,
                transition: 'transform 0.3s ease-out, filter 0.3s ease-out'
            }}
            className={cn(
                "relative overflow-hidden rounded-2xl bg-zinc-900 group border transition-all duration-500 ease-out select-none",
                isGrid
                    ? "border-zinc-800/30 shadow-sm"
                    : (isActive ? "scale-105 border-zinc-600 shadow-2xl" : "scale-95 opacity-80")
            )}
        >
            {/* Action Buttons Layer */}
            <div
                className="absolute inset-y-0 right-0 flex items-stretch z-0"
                style={{ width: `${Math.max(swipeOffset, maxOffset)}px` }}
            >
                {actions.map((action, index) => (
                    <button
                        key={action.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            action.onClick?.();
                            setSwipeOffset(0);
                        }}
                        className={cn(
                            "flex flex-col items-center justify-center text-white transition-opacity",
                            action.color,
                            swipeOffset > 0 ? "opacity-100" : "opacity-0"
                        )}
                        style={{
                            width: index === 0
                                ? `${actionWidth + Math.max(0, swipeOffset - maxOffset)}px`
                                : `${actionWidth}px`
                        }}
                    >
                        <action.icon className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-bold uppercase">{action.label}</span>
                    </button>
                ))}
            </div>

            {/* Main Content Layer */}
            <div
                ref={containerRef}
                onClick={handleMainClick}
                style={{
                    transform: `translateX(${-swipeOffset}px)`,
                    transition: isSwiping ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                className={cn(
                    "relative aspect-[4/5] w-full overflow-hidden cursor-pointer transition-all bg-gradient-to-br from-gray-700 to-gray-800 z-10"
                )}
            >
                {/* Loading Indicator */}
                {!imageLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center z-5">
                        <div className="w-8 h-8 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}

                <img
                    src={material.coverUrl}
                    className={cn(
                        "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
                        imageLoaded ? "opacity-100" : "opacity-0",
                        isGrid
                            ? "grayscale-0 group-hover:scale-105 transition-all duration-700"
                            : (isActive ? "grayscale-0 group-hover:scale-105 transition-all duration-700" : "opacity-60 grayscale")
                    )}
                    alt={material.title}
                    draggable={false}
                    onLoad={() => setImageLoaded(true)}
                    onError={(e) => {
                        setImageLoaded(true); // 即使失败也显示，避免永久loading
                        // Fallback: hide broken image and show gradient background
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 via-60% to-transparent z-10"></div>

                {isPinned && variant !== 'hero' && (
                    <div className="absolute top-4 left-4 z-20">
                        <div className="bg-amber-500 rounded-full p-1 shadow-lg shadow-black/50">
                            <Pin className="w-3 h-3 text-white fill-current" />
                        </div>
                    </div>
                )}

                {/* Favorites (Star) Button in Top Right */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar?.();
                    }}
                    className="absolute top-4 right-4 z-20 p-2 text-white transition-all active:scale-90"
                >
                    <Star
                        className={cn(
                            "w-5 h-5 transition-all text-white/70 drop-shadow-md",
                            material.userMeta?.isStarred && "fill-amber-400 text-amber-400"
                        )}
                    />
                </button>

                <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
                    {/* Standardized Tags Section */}
                    <div className="flex flex-wrap gap-2 mb-3">
                        {material.location === 'daily_spark' && showDailySparkTags ? (
                            <>
                                {/* Blue Tag: Daily Spark */}
                                <span className="px-3 py-1 rounded-2xl bg-indigo-500/30 text-indigo-100 border border-indigo-400/40 text-[11px] font-bold tracking-wide">
                                    每日短句
                                </span>
                                {/* Date Tag */}
                                <span className="px-3 py-1 rounded-2xl bg-zinc-400/20 backdrop-blur-xl text-zinc-50 border border-white/20 text-[11px] font-medium tracking-wide shadow-sm">
                                    {(() => {
                                        const now = new Date();
                                        const beijingDate = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
                                        return `${beijingDate.getMonth() + 1}月${beijingDate.getDate()}日`;
                                    })()}
                                </span>
                            </>
                        ) : material.visibility === 'private' ? (
                            <>
                                <span className="px-3 py-1 rounded-2xl bg-amber-900/40 text-amber-500 border border-amber-500/30 text-[11px] font-bold tracking-wide">
                                    私有资料
                                </span>
                                <span className="px-3 py-1 rounded-2xl bg-zinc-800/60 backdrop-blur-md text-zinc-400 border border-white/10 text-[11px] font-medium tracking-wide shadow-sm">
                                    {new Date(material.createdAt || Date.now()).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}  {new Date(material.createdAt || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                </span>
                            </>
                        ) : (
                            <>
                                {material.tags.topic && (
                                    <span className={cn(
                                        "px-3 py-1 rounded-2xl text-[11px] font-bold tracking-wide border border-current/20 opacity-90 backdrop-blur-sm",
                                        (() => {
                                            const topic = material.tags.topic.toLowerCase();
                                            if (topic.includes('busines') || topic.includes('商业') || topic.includes('职场'))
                                                return "bg-indigo-500/20 text-indigo-300 border-indigo-400/20";
                                            if (topic.includes('tech') || topic.includes('科技') || topic.includes('技术'))
                                                return "bg-emerald-500/20 text-emerald-300 border-emerald-400/20";
                                            if (topic.includes('life') || topic.includes('生活') || topic.includes('日常'))
                                                return "bg-amber-500/20 text-amber-300 border-amber-400/20";
                                            if (topic.includes('cultur') || topic.includes('文化') || topic.includes('艺术'))
                                                return "bg-purple-500/20 text-purple-300 border-purple-400/20";
                                            if (topic.includes('news') || topic.includes('新闻') || topic.includes('时政'))
                                                return "bg-blue-500/20 text-blue-300 border-blue-400/20";
                                            if (topic.includes('movie') || topic.includes('show') || topic.includes('电影') || topic.includes('娱乐'))
                                                return "bg-rose-500/20 text-rose-300 border-rose-400/20";
                                            if (topic.includes('edu') || topic.includes('教育') || topic.includes('学习'))
                                                return "bg-teal-500/20 text-teal-300 border-teal-400/20";

                                            const colors = [
                                                "bg-zinc-500/20 text-zinc-300 border-zinc-400/20",
                                                "bg-cyan-500/20 text-cyan-300 border-cyan-400/20",
                                                "bg-orange-500/20 text-orange-300 border-orange-400/20",
                                                "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/20",
                                                "bg-lime-500/20 text-lime-300 border-lime-400/20"
                                            ];
                                            const hash = topic.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                                            return colors[hash % colors.length];
                                        })()
                                    )}>
                                        {material.tags.topic}
                                    </span>
                                )}

                                {material.tags.difficulty && (
                                    <span className={cn(
                                        "px-2.5 py-1 rounded-2xl text-[10px] font-black tracking-tighter border opacity-90 backdrop-blur-sm shadow-sm",
                                        material.tags.difficulty === 'L1' && "bg-emerald-500/20 text-emerald-400 border-emerald-400/30",
                                        material.tags.difficulty === 'L2' && "bg-amber-500/20 text-amber-400 border-amber-400/30",
                                        material.tags.difficulty === 'L3' && "bg-rose-500/20 text-rose-400 border-rose-400/30"
                                    )}>
                                        {material.tags.difficulty}
                                    </span>
                                )}
                            </>
                        )}
                    </div>

                    <h2 className={cn(
                        "text-white tracking-tight leading-7 line-clamp-2 mb-2 font-medium",
                        isGrid ? "text-xl" : "text-2xl"  // Hero (Daily Spark) is larger, grid cards smaller
                    )}>
                        {material.title}
                    </h2>

                    {/* Ported Translation UI from AnalysisView */}
                    {material.title_translate && (
                        <div className="mb-3 animate-in fade-in slide-in-from-left-2 duration-700 delay-300 fill-mode-both">
                            <div className="text-sm text-zinc-500 font-medium leading-relaxed pl-2 border-l-2 border-indigo-500/30 line-clamp-2">
                                {material.title_translate}
                            </div>
                        </div>
                    )}

                    {/* Metadata Row: Duration & Progress */}
                    <div className="flex items-center gap-4 text-zinc-400">
                        <span className="text-sm font-medium">{material.tags.duration}</span>

                        {/* 3-Segment Progress Indicator */}
                        <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                            {[1, 2, 3].map(step => (
                                <div
                                    key={step}
                                    className={cn(
                                        "h-1.5 rounded-full transition-all duration-500 flex-1",
                                        (material.userMeta?.currentStep || 0) >= step
                                            ? "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                            : "bg-zinc-700/50"
                                    )}
                                />
                            ))}
                        </div>

                        {isGrid && material.subtitle && (
                            <p className="hidden text-xs text-zinc-500 line-clamp-1 opacity-60 ml-auto">
                                {material.subtitle}
                            </p>
                        )}
                    </div>
                </div>
            </div >
        </div >
    );
});
