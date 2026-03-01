import posthog from 'posthog-js';

let isInitialized = false;

// 🔥 立即初始化（或者保留 init 方法供前端显性调用，但内部要保证单例）
// 在这里我们重构为尽早初始化，避免点击早于 RevenueCat 初始化时丢失数据。
export const analytics = {
    init: () => {
        if (isInitialized) return;

        console.log('🚀 [Analytics] Initializing PostHog...');
        posthog.init('phc_EWLfo8lWxQclFRgAvAE3KYhqUKrQevwFlIJuzjA4207', {
            api_host: 'https://us.i.posthog.com',
            person_profiles: 'identified_only',
            capture_pageview: false, // We handle this manually for SPAs
            autocapture: true, // 确保开启点击捕捉
        });
        isInitialized = true;
        console.log('✅ [Analytics] PostHog initialized');
    },
    identify: (userId: string) => {
        if (!isInitialized) analytics.init(); // 防御性调用
        console.log('👤 [Analytics] Identifying user:', userId);
        posthog.identify(userId);
    },
    track: (eventName: string, properties?: Record<string, any>) => {
        if (!isInitialized) analytics.init(); // 重大修复：如果没有初始化，这里强制初始化，防止漏掉首个点击
        console.log('📊 [Analytics] Tracking event:', eventName, properties);
        posthog.capture(eventName, properties);
    }
};

// 预初始化，确保尽早可以捕获事件
analytics.init();
