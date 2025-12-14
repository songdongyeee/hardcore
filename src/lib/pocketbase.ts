import PocketBase from 'pocketbase';

// Initialize PocketBase
// Note: In real prod, this is your backend URL. 
// For this mock implementation, we use a placeholder or local address.
export const pb = new PocketBase('http://8.138.201.147:8090');

// Auto-cancellation generic
export const autoCancel = false;
