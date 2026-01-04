/// <reference types="vite/client" />

// PostHog global type declaration
interface Window {
    posthog?: {
        capture: (event: string, properties?: Record<string, any>) => void;
        identify: (userId: string, properties?: Record<string, any>) => void;
        reset: () => void;
    };
}
