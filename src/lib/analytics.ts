import posthog from 'posthog-js';

export const analytics = {
    init: () => {
        console.log('🚀 [Analytics] Initializing PostHog...');
        posthog.init('phc_EWLfo8lWxQclFRgAvAE3KYhqUKrQevwFlIJuzjA4207', {
            api_host: 'https://us.i.posthog.com',
            person_profiles: 'identified_only',
            capture_pageview: false, // We handle this manually for SPAs
        });
        console.log('✅ [Analytics] PostHog initialized');
    },
    identify: (userId: string) => {
        console.log('👤 [Analytics] Identifying user:', userId);
        posthog.identify(userId);
    },
    track: (eventName: string, properties?: Record<string, any>) => {
        console.log('📊 [Analytics] Tracking event:', eventName, properties);
        posthog.capture(eventName, properties);
    }
};
