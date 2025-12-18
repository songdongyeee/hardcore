import { cn } from "@/lib/utils";
import { useLongPress } from "@/hooks/useLongPress";

interface SentenceWrapperProps {
    isActive: boolean;
    onLongPress: () => void;
    children: React.ReactNode;
}

export function SentenceWrapper({ isActive, onLongPress, children }: SentenceWrapperProps) {
    // 1. Gesture Binding on Parent
    const bind = useLongPress(
        onLongPress,
        () => { }, // Click is handled by children (words) or ignored
        { delay: 400 }
    );

    return (
        <div
            {...bind}
            className={cn(
                "mb-6 leading-loose rounded-xl p-2 transition-colors duration-300 relative",
                // 2. Disable Selection & System Menu
                "select-none cursor-default",
                isActive ? "bg-amber-500/20" : "bg-transparent"
            )}
            style={{
                // Critical for iOS
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                userSelect: 'none',
            }}
        >
            {/* 3. Text Container - Just Renders */}
            <p className="pointer-events-auto">
                {children}
            </p>
        </div>
    );
}
