import { cn } from "@/lib/utils";

interface HeaderProps {
  onNavigateHome: () => void;
  className?: string;
}

export function Header({ onNavigateHome, className }: HeaderProps) {
  return (
    <header className={cn("absolute top-0 left-0 right-0 z-50 px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none", className)}>
      <div
        className="flex items-center gap-2 pointer-events-auto cursor-pointer opacity-0"
        onClick={onNavigateHome}
      >
        <div className="bg-white w-2 h-2 rounded-full"></div>
        <span className="text-sm font-semibold text-white tracking-tighter">HARDCORE.</span>
      </div>
      <div className="pointer-events-none"></div>
    </header>
  );
}
