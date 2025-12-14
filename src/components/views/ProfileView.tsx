import { ChevronLeft, User, Power } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface ProfileViewProps {
    onBack: () => void;
}

export function ProfileView({ onBack }: ProfileViewProps) {
    const { user, isVip, loginWithApple, logout, deleteAccount } = useAuth();

    return (
        <div className="fixed inset-0 z-50 bg-black text-white flex flex-col pt-[env(safe-area-inset-top)]">
            {/* Header */}
            <div className="h-14 flex items-center px-4 border-b border-zinc-900">
                <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white">
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <h1 className="text-lg font-bold ml-2">个人中心</h1>
            </div>

            <div className="flex-1 p-6 space-y-8">
                {/* Identity Card */}
                <div className="flex flex-col items-center space-y-4 py-8">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl border-4 ${isVip ? 'border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                        {user ? (
                            user.avatar ? <img src={user.avatar} className="w-full h-full rounded-full object-cover" /> : user.name?.[0].toUpperCase()
                        ) : (
                            <User className="w-10 h-10" />
                        )}
                    </div>

                    <div className="text-center">
                        {user ? (
                            <>
                                <h2 className="text-xl font-bold">{user.name || user.email}</h2>
                                {isVip ? (
                                    <span className="inline-block mt-2 px-3 py-1 bg-amber-500/20 text-amber-500 text-xs font-bold rounded-full border border-amber-500/50">
                                        HARDCORE VIP
                                    </span>
                                ) : (
                                    <span className="inline-block mt-2 px-3 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-full">
                                        Free User
                                    </span>
                                )}
                            </>
                        ) : (
                            <>
                                <h2 className="text-xl font-bold">游客 / Guest</h2>
                                <p className="text-sm text-zinc-500 mt-1">登录以防学习记录丢失</p>
                            </>
                        )}
                    </div>
                </div>

                {/* Actions */}
                {!user ? (
                    <div className="space-y-4">
                        <button
                            onClick={loginWithApple}
                            className="w-full h-12 bg-white text-black font-medium rounded-lg flex items-center justify-center gap-2 active:scale-95 transition"
                        >
                            {/* Apple Logo SVG */}
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.74 1.18 0 2.45-1.03 3.56-1.03 2.14 0 3.73 1.09 4.41 1.97-3.47 1.73-2.93 5.86.32 7.14-.54 2.12-2.3 5.4-3.37 4.15zM12.03 7.25c-.25-2.19 1.63-4.04 3.48-4.25.32 2.37-2.08 4.33-3.48 4.25z" /></svg>
                            Sign in with Apple
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <button
                            onClick={logout}
                            className="w-full h-12 bg-zinc-900 border border-zinc-800 text-red-500 font-medium rounded-lg flex items-center justify-center gap-2 active:scale-95 transition hover:bg-zinc-800"
                        >
                            <Power className="w-5 h-5" />
                            退出登录
                        </button>

                        <div className="pt-8 flex justify-center">
                            <button
                                onClick={() => {
                                    if (window.confirm("确定要注销账号吗？此操作不可逆。\n\n将清除所有学习记录和会员状态。")) {
                                        deleteAccount();
                                        onBack(); // Close profile
                                        alert("账号已注销");
                                    }
                                }}
                                className="text-xs text-red-500/80 hover:text-red-500 py-2 border-b border-transparent hover:border-red-500 transition-colors"
                            >
                                注销账号 (Delete Account)
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}

