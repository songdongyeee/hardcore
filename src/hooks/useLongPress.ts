import { useRef, useCallback } from 'react';

interface Options {
    delay?: number;
    shouldPreventDefault?: boolean;
}

export const useLongPress = (
    onLongPress: (e: any) => void,
    onClick: (e: any) => void,
    { delay = 500, shouldPreventDefault = true }: Options = {}
) => {
    const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const target = useRef<EventTarget | null>(null);

    const start = useCallback(
        (event: any) => {
            // Prevent Ghost Clicks if needed, but usually we handle that in clean up
            if (shouldPreventDefault && event.target) {
                // event.target.addEventListener('touchend', preventDefault, { passive: false });
                target.current = event.target;
            }

            timeout.current = setTimeout(() => {
                onLongPress(event);
            }, delay);
        },
        [onLongPress, delay, shouldPreventDefault]
    );

    const clear = useCallback(
        (event: any, shouldTriggerClick = true) => {
            if (timeout.current) {
                clearTimeout(timeout.current);
                timeout.current = null;
                if (shouldTriggerClick) {
                    onClick(event);
                }
            }
        },
        [onClick]
    );

    return {
        onMouseDown: (e: any) => start(e),
        onTouchStart: (e: any) => start(e),
        onMouseUp: (e: any) => clear(e, true),
        onMouseLeave: (e: any) => clear(e, false),
        onTouchEnd: (e: any) => clear(e, true),
    };
};
