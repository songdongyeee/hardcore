import React from 'react';

export const TranscriptSkeleton: React.FC = () => {
    return (
        <div className="w-full space-y-6 px-4 py-6">
            {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex flex-col space-y-2 animate-pulse">
                    {/* 句子骨架 */}
                    <div className="h-4 bg-white/10 rounded w-3/4"></div>
                    <div className="h-4 bg-white/10 rounded w-1/2"></div>
                    {/* 翻译骨架 */}
                    <div className="h-3 bg-white/5 rounded w-2/3 mt-2"></div>
                </div>
            ))}
        </div>
    );
};

export const WaveformSkeleton: React.FC = () => {
    return (
        <div className="w-full h-full flex items-center justify-center space-x-1 animate-pulse opacity-50">
            {[...Array(40)].map((_, i) => (
                <div
                    key={i}
                    className="w-1 bg-white/20 rounded-full"
                    style={{
                        height: `${Math.max(20, Math.random() * 60)}%`,
                        animationDelay: `${i * 0.05}s`
                    }}
                ></div>
            ))}
        </div>
    );
};
