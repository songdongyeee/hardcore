import { useState, useEffect } from 'react';
import { X, Zap, FolderOpen, Check, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from "@/lib/utils";

interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    status: 'initial' | 'progress' | 'success' | 'error';
    importProgress: number;
    onImport: (language: string) => void;
    onUpgrade?: () => void;
    usedSeconds?: number; // How many seconds the user has already used
    subscriptionTier?: 'free' | 'monthly' | 'quarterly' | 'yearly'; // User's subscription tier
    fileName?: string;
    progressMessage?: string; // Current stage message
    errorMessage?: string;
    onSuccessComplete: () => void;
}

const LANGUAGES = [
    { code: 'en', name: '英语', label: 'English' },
    { code: 'ja', name: '日语', label: 'Japanese' },
    { code: 'ko', name: '韩语', label: 'Korean' },
    { code: 'yue', name: '粤语', label: 'Cantonese' },
    { code: 'fr', name: '法语', label: 'French' },
    { code: 'es', name: '西班牙语', label: 'Spanish' },
    { code: 'de', name: '德语', label: 'German' },
    { code: 'ru', name: '俄语', label: 'Russian' },
    { code: 'pt', name: 'Portuguese', label: '葡萄牙语' },
    { code: 'it', name: '意大利语', label: 'Italian' },
];

export function UploadModal({
    isOpen,
    onClose,
    status,
    importProgress,
    onImport,
    onUpgrade,
    usedSeconds = 0,
    subscriptionTier = 'free',
    fileName,
    progressMessage,
    errorMessage,
    onSuccessComplete
}: UploadModalProps) {
    const [selectedLanguage, setSelectedLanguage] = useState('en');
    const [showAllLangs, setShowAllLangs] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    // Calculate remaining quota based on tier
    const QUOTA_MAP = {
        free: 60,           // 60 seconds
        monthly: 1800,      // 30 minutes
        quarterly: 10800,   // 180 minutes
        yearly: 72000       // 1200 minutes
    };
    const TOTAL_QUOTA = QUOTA_MAP[subscriptionTier];
    const remainingSeconds = Math.max(0, TOTAL_QUOTA - usedSeconds);
    const isQuotaExhausted = remainingSeconds <= 0;

    // Handle visibility for transition
    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
        } else {
            const timer = setTimeout(() => setIsVisible(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Handle success auto-close
    useEffect(() => {
        if (status === 'success') {
            const timer = setTimeout(() => {
                onSuccessComplete();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [status, onSuccessComplete]);

    if (!isVisible && !isOpen) return null;

    const displayLangs = showAllLangs ? LANGUAGES : LANGUAGES.slice(0, 5);

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={() => status !== 'progress' && onClose()}
            />

            {/* Modal Container */}
            <div
                className={cn(
                    "fixed bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:max-w-md w-full bg-[#121212] z-[70] rounded-t-[2.5rem] border-t border-zinc-800 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col max-h-[90vh]",
                    isOpen ? "translate-y-0" : "translate-y-full"
                )}
            >
                {/* Handle for dragging aesthetic */}
                <div className="w-full flex justify-center pt-4 pb-1">
                    <div className="w-12 h-1.5 bg-zinc-800 rounded-full"></div>
                </div>

                <div className="p-6 pt-2 space-y-6 flex-1 overflow-y-auto no-scrollbar">

                    {/* Header */}
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-medium tracking-tight text-white">
                            {status === 'error' ? '上传失败' : '导入材料'}
                        </h3>
                        <button
                            onClick={onClose}
                            disabled={status === 'progress'}
                            className="p-1 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors disabled:opacity-30"
                        >
                            <X className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                    </div>

                    {status === 'initial' && (
                        <>
                            {/* Quota Warning */}
                            {(
                                <div className={cn(
                                    "rounded-2xl p-4 flex gap-4 items-center",
                                    isQuotaExhausted
                                        ? "bg-red-500/5 border border-red-500/20"
                                        : "bg-amber-500/5 border border-amber-500/20"
                                )}>
                                    <Zap className={cn(
                                        "w-5 h-5 shrink-0",
                                        isQuotaExhausted ? "text-red-500" : "text-amber-500"
                                    )} strokeWidth={1.5} />
                                    <div className="flex-1 space-y-0.5">
                                        <p className={cn(
                                            "text-sm font-medium",
                                            isQuotaExhausted ? "text-red-200" : "text-amber-200"
                                        )}>
                                            {isQuotaExhausted ? '额度已用完' : subscriptionTier === 'free' ? '免费额度' : '会员额度'}
                                        </p>
                                        <p className={cn(
                                            "text-sm font-light leading-relaxed",
                                            isQuotaExhausted ? "text-red-400/80" : "text-amber-500/80"
                                        )}>
                                            {isQuotaExhausted
                                                ?
                                                '转写服务由通义付费提供，升级会员可获更高额度'
                                                : (
                                                    <>
                                                        您目前拥有 {Math.floor(remainingSeconds / 60)} 分钟转写额度，<br />
                                                        {subscriptionTier === 'free' && '单次上传文件大小50M以内。'}
                                                        {subscriptionTier === 'monthly' && '单次上传文件大小500M以内。'}
                                                        {subscriptionTier === 'quarterly' && '单次上传文件大小1GB以内。'}
                                                        {subscriptionTier === 'yearly' && '单次上传文件不限大小。'}
                                                    </>
                                                )
                                            }
                                        </p>
                                    </div>
                                    <button
                                        onClick={onUpgrade}
                                        className={cn(
                                            "px-4 py-1.5 text-black text-xs font-bold rounded-full active:scale-95 transition-all",
                                            isQuotaExhausted
                                                ? "bg-red-500 hover:bg-red-400"
                                                : "bg-amber-500 hover:bg-amber-400"
                                        )}
                                    >
                                        升级
                                    </button>
                                </div>
                            )}

                            {/* Language Selector */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-zinc-400 ml-1">选择材料语种：</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {displayLangs.map((lang) => (
                                        <button
                                            key={lang.code}
                                            onClick={() => setSelectedLanguage(lang.code)}
                                            disabled={status !== 'initial'}
                                            className={cn(
                                                "text-sm py-3 rounded-xl transition-all font-medium border relative overflow-hidden",
                                                selectedLanguage === lang.code
                                                    ? "ring-1 ring-white/30 bg-zinc-700 text-white border-transparent shadow-lg shadow-white/10"
                                                    : "bg-zinc-900/50 text-zinc-500 border-transparent hover:bg-zinc-800/80 hover:text-zinc-400 active:scale-[0.97]"
                                            )}
                                        >
                                            {selectedLanguage === lang.code && (
                                                <div className="absolute top-0 right-0 p-1">
                                                    <div className="w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_white]" />
                                                </div>
                                            )}
                                            {lang.name}
                                        </button>
                                    ))}

                                    {!showAllLangs && (
                                        <button
                                            onClick={() => setShowAllLangs(true)}
                                            className="bg-zinc-900/50 text-zinc-500 text-sm py-3 rounded-xl transition-all hover:bg-zinc-800 hover:text-zinc-300 border border-transparent hover:border-zinc-700 flex items-center justify-center gap-1"
                                        >
                                            <span>更多</span>
                                            <ChevronDown className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Action Button */}
                            <div className="pt-2">
                                <button
                                    onClick={() => onImport(selectedLanguage)}
                                    disabled={isQuotaExhausted}
                                    className={cn(
                                        "w-full font-semibold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5 transform duration-100",
                                        isQuotaExhausted
                                            ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                            : "bg-white text-black hover:bg-zinc-200 active:scale-[0.98]"
                                    )}
                                >
                                    <FolderOpen className="w-5 h-5" strokeWidth={1.5} />
                                    {isQuotaExhausted ? '额度已用完' : '从设备选择文件'}
                                </button>
                                <p className="text-center text-xs text-zinc-500 mt-4 font-light">
                                    支持音频、视频文件
                                </p>
                            </div>
                        </>
                    )}

                    {status === 'progress' && (
                        <div className="py-10 space-y-6 animate-in fade-in duration-300">
                            <div className="space-y-4">
                                <div className="flex justify-between items-end">
                                    <div className="space-y-1 overflow-hidden">
                                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                                            {progressMessage || '正在处理...'}
                                        </p>
                                        <p className="text-base text-zinc-200 font-medium truncate max-w-[250px]">{fileName || '正在处理文件...'}</p>
                                    </div>
                                    <span className="text-2xl font-light text-white">{importProgress}%</span>
                                </div>

                                <div className="h-2.5 bg-zinc-800/50 rounded-full overflow-hidden border border-white/5">
                                    <div
                                        className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full shadow-[0_0_15px_rgba(99,102,241,0.4)]"
                                        style={{ width: `${importProgress}%` }}
                                    />
                                </div>
                                <p className="text-xs text-zinc-500 text-center font-light italic">
                                    转写及翻译由通义千问付费支持
                                </p>
                            </div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4 animate-in fade-in zoom-in duration-300">
                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center text-green-500 mb-2">
                                <Check className="w-8 h-8" strokeWidth={3} />
                            </div>
                            <h4 className="text-xl font-medium text-white">上传成功</h4>
                            <p className="text-sm text-zinc-400 text-center px-6 leading-relaxed">
                                {fileName} 已成功添加到您的库中。
                            </p>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4 animate-in fade-in zoom-in duration-300">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 mb-2">
                                <AlertCircle className="w-8 h-8" strokeWidth={2} />
                            </div>
                            <h4 className="text-xl font-medium text-white">抱歉，出了点问题</h4>
                            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 w-full">
                                <p className="text-sm text-red-400 font-light text-center leading-relaxed">
                                    {errorMessage || '上传过程中发生了未知错误。'}
                                </p>
                            </div>

                            {/* Show upgrade button if error is about file size limit */}
                            <div className="flex gap-3 mt-2">
                                {errorMessage?.includes('文件大小') && errorMessage?.includes('限制') && subscriptionTier !== 'yearly' && onUpgrade && (
                                    <button
                                        onClick={() => {
                                            onClose();
                                            onUpgrade?.();
                                        }}
                                        className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-medium rounded-lg hover:opacity-90 active:scale-95 transition-all"
                                    >
                                        升级会员
                                    </button>
                                )}
                                <button
                                    onClick={() => onClose()}
                                    className="px-6 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors border border-zinc-700 rounded-lg hover:border-zinc-500"
                                >
                                    返回重试
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Safe area padding */}
                <div className="h-8 md:h-6 shrink-0" />
            </div>
        </>
    );
}
