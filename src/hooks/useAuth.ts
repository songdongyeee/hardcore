
import { useState, useEffect } from 'react';
import { SignInWithApple, type SignInWithAppleResponse, type SignInWithAppleOptions } from '@capacitor-community/apple-sign-in';
import { pb } from '@/lib/pocketbase';
import { clearUsageRecord } from './useUsageLimit';

export function useAuth() {
    const [user, setUser] = useState(pb.authStore.model);
    const [isVip, setIsVip] = useState(false); // Can be derived from user model in real app

    useEffect(() => {
        // Subscribe to auth changes
        return pb.authStore.onChange((_token, model) => {
            setUser(model);
            // In real world, check model.subscription_status
            // For this mock, we persist VIP state if we simulated it
            if (model && (model as any).isVip) {
                setIsVip(true);
            } else {
                setIsVip(false);
            }
        });
    }, []);

    const loginWithApple = async () => {
        try {
            const options: SignInWithAppleOptions = {
                clientId: 'com.hardcore.language', // Bundle ID
                redirectURI: 'https://placeholder.com', // Not used for native info retrieval usually
                scopes: 'email name',
                state: '12345',
                nonce: 'nonce',
            };

            const result: SignInWithAppleResponse = await SignInWithApple.authorize(options);

            if (result.response && result.response.identityToken) {
                console.log("Apple Sign In Success:", result);

                // --- MOCK BACKEND VERIFICATION ---
                // "Due to HTTP environment... DO NOT send token to backend validation"
                // "Manually save a simulated Auth Token"

                const mockToken = "mock_jwt_token_for_dev_" + Date.now();
                const mockUser = {
                    id: "user_" + result.response.user,
                    email: result.response.email || "apple_user@test.com",
                    name: (result.response.givenName || "Apple") + " " + (result.response.familyName || "User"),
                    avatar: "",
                    isVip: false, // Initially not VIP
                    collectionId: 'users',
                    collectionName: 'users',
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                };

                // Save to PocketBase Store manually
                pb.authStore.save(mockToken, mockUser as any); // Cast to any or RecordModel to satisfy TS

                return { success: true };
            }
            return { success: false, error: 'No identity token' };
        } catch (error: any) {
            console.error("Apple Login Failed:", error);
            return { success: false, error: error.message };
        }
    };

    const logout = () => {
        pb.authStore.clear();
    };

    const deleteAccount = async () => {
        // 1. Clear Auth
        pb.authStore.clear();
        // 2. Clear Local Usage / Limits
        await clearUsageRecord();
        // 3. Clear any other potential specific keys if added later
    };

    const upgradeToVip = () => {
        // Simulate Payment Success -> Update Local State
        if (pb.authStore.model) {
            const updatedUser = { ...pb.authStore.model, isVip: true };
            // Hack to update store
            pb.authStore.save(pb.authStore.token, updatedUser);
            setIsVip(true);
        }
    };

    return {
        user,
        isVip,
        isAuthenticated: !!user,
        loginWithApple,
        logout,
        deleteAccount,
        upgradeToVip
    };
}

