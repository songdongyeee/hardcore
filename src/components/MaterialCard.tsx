import { Award } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Material {
    id: string;
    title: string;
    subtitle?: string;
    imageUrl: string;
    duration?: string;
    label?: { text: string; type: 'hard' | 'new' | 'mastered' };
    progress?: number;
    audioUrl: string;
}

interface MaterialCardProps {
    material: Material;
    isActive: boolean;
    onClick: () => void;
}

export function MaterialCard({ material, isActive, onClick }: MaterialCardProps) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "group relative aspect-[4/5] w-full rounded-2xl overflow-hidden cursor-pointer border border-zinc-900 transition-all duration-500 ease-out",
                isActive ? "scale-105 border-zinc-600 shadow-2xl z-10" : "scale-95 opacity-80 z-0"
            )}
        >
            <img
                src={material.imageUrl}
                className={cn(
                    "absolute inset-0 w-full h-full object-cover transition-all duration-700",
                    isActive ? "opacity-100 grayscale-0" : "opacity-60 grayscale"
                )}
                alt={material.title}
            />

            {/* Gradient Overlay - Always visible/strong, no transition to opacity-80 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 via-50% to-transparent z-10"></div>

            <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
                <div className="flex items-center gap-2 mb-3">
                    {material.label && (
                        <span className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium tracking-wide border",
                            material.label.type === 'hard' && "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
                            material.label.type === 'new' && "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
                            material.label.type === 'mastered' && "bg-amber-500/20 text-amber-500 border-amber-500/30 text-amber-500",
                        )}>
                            {material.label.type === 'mastered' && <Award className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
                            {material.label.text}
                        </span>
                    )}
                    {material.duration && (
                        <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700 text-xs font-medium tracking-wide">
                            {material.duration}
                        </span>
                    )}
                </div>

                <h2 className="text-2xl font-semibold text-white tracking-tight leading-snug mb-2">
                    {material.title}
                </h2>

                {material.subtitle && (
                    <p className="text-sm text-zinc-400 line-clamp-2">{material.subtitle}</p>
                )}

                {/* Progress Bar (Only show if there is progress) */}
                {material.progress !== undefined && (
                    <div className="flex items-center gap-3 mt-3">
                        <div className="flex-1 h-1 bg-zinc-700/50 rounded-full overflow-hidden backdrop-blur-sm">
                            <div
                                className="h-full bg-white transition-all duration-1000"
                                style={{ width: `${material.progress}%` }}
                            ></div>
                        </div>
                        <span className="text-xs text-zinc-300 font-medium">Phase 1</span>
                    </div>
                )}
            </div>
        </div>
    );
}
