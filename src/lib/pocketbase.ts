import PocketBase from 'pocketbase';

// PocketBase client instance
export const pb = new PocketBase('https://zjcnex.top');

// Auto-refresh auth token
pb.authStore.onChange(() => {
    console.log('[PocketBase] Auth changed:', pb.authStore.isValid);
});
