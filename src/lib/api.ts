import PocketBase from 'pocketbase';
import type { TranscriptSegment } from '@/data/transcript';
import { Preferences } from '@capacitor/preferences';
import { CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export const pb = new PocketBase('https://zjcnex.top');

export interface TranscriptRecord {
    id: string;
    audio: string;
    status: 'processing' | 'done' | 'error';
    text: string; // JSON string of Aliyun result
    created: string;
    updated: string;
}

// Helper to convert Aliyun JSON format to our App's TranscriptSegment format
function parseAliyunTranscript(data: any): TranscriptSegment[] {
    try {
        // 🔥 Handle array format: data is an array, take first element
        let transcriptObj = data;
        if (Array.isArray(data) && data.length > 0) {
            transcriptObj = data[0];
        }

        // 🔥 Use 'sentences' field (not 'transcripts')
        const sentences = transcriptObj.sentences || [];

        return sentences.map((s: any) => ({
            start: (s.begin_time || 0) / 1000, // 🔥 Use begin_time (not start_time)
            end: (s.end_time || 0) / 1000,
            text: s.text,
            translation: s.translation, // 🆕 Chinese translation (sentence-level)
            words: s.words?.map((w: any) => ({
                text: w.text,
                start: (w.begin_time || 0) / 1000, // 🔥 Use begin_time
                end: (w.end_time || 0) / 1000
            })) || []
        }));
    } catch (e) {
        console.error("Failed to parse transcript JSON", e);
        return [];
    }
}

export async function getLatestTranscript(): Promise<{ url: string; segments: TranscriptSegment[] } | null> {
    try {
        // 1. Fetch the most recent 'done' record
        const record = await pb.collection('transcripts').getFirstListItem<TranscriptRecord>('status="done"', {
            sort: '-created',
        });

        if (!record) return null;

        let transcriptData: any = [];

        // 🔍 CHECK FOR SERVER DOWNLOAD FAILURE (Fail-Safe)
        // 🚨 NUCLEAR OPTION: Ignore JSON parsing, just look for the Link string directly.
        // FIX: PocketBase SDK returns an Object, not string. We must stringify it to search!
        const fullText = (typeof record.text === 'object') ? JSON.stringify(record.text) : (record.text || "");

        if (fullText.includes("Link: https")) {
            // ⚠️ Server Failed. Client rescue!
            console.warn("Server failed to download. Attempting Client-Side Fetch (String Search)...");

            // Extract URL from raw text
            const match = fullText.match(/(https:\/\/[^\s"']+)/);

            if (match && match[1]) {
                let aliyunUrl = match[1];
                // 🧹 Clean up
                aliyunUrl = aliyunUrl.replace(/&amp;/g, '&');

                try {
                    console.log("Attempting Native HTTP (Try 1: Raw)...", aliyunUrl);
                    let res = await CapacitorHttp.get({ url: aliyunUrl });

                    if (res.status !== 200) {
                        const decodedUrl = decodeURIComponent(aliyunUrl);
                        console.log("Attempting Native HTTP (Try 2: Decoded)...", decodedUrl);
                        res = await CapacitorHttp.get({ url: decodedUrl });
                    }

                    let realData = res.data;
                    if (typeof realData === 'string') {
                        try { realData = JSON.parse(realData); } catch { }
                    }

                    if (realData && (realData.transcripts || Array.isArray(realData))) {
                        transcriptData = realData.transcripts ? realData.transcripts : realData;
                        console.log("Client-Side Native Fetch Success!");
                    } else {
                        // Fallback to error if JSON is bad
                        throw new Error("Invalid JSON response from Aliyun");
                    }
                } catch (err: any) {
                    console.error("Client-Side Fetch Failed", err);
                    transcriptData = [{
                        text: `[Rescue Failed v6] Native Http Error: ${err.message || JSON.stringify(err)}\n\nURL: ${aliyunUrl}`
                    }];
                }
            } else {
                transcriptData = [{ text: "[Rescue Failed v6] No URL found in text." }];
            }
        } else {
            // Normal Success Case (hopefully)
            try {
                transcriptData = JSON.parse(fullText);
            } catch { transcriptData = []; }
        }

        // 2. Parse the text JSON (Normal or Rescued)
        const segments = parseAliyunTranscript(transcriptData);

        // 3. Construct full audio URL
        const audioUrl = pb.files.getUrl(record, record.audio);

        return {
            url: audioUrl,
            segments
        };
    } catch (e) {
        console.warn("No transcript found or API error:", e);
        return null; // Return null to fallback to default
    }
}

export async function getCachedTranscript(): Promise<{ url: string; segments: TranscriptSegment[] } | null> {
    try {
        const result = await Filesystem.readFile({
            path: 'cache/last_transcript.json',
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });
        return JSON.parse(result.data as string);
    } catch (e) {
        return null;
    }
}

export async function saveTranscriptToCache(data: { url: string; segments: TranscriptSegment[] }) {
    try {
        await Filesystem.mkdir({
            path: 'cache',
            directory: Directory.Documents,
            recursive: true
        }).catch(() => { });

        await Filesystem.writeFile({
            path: 'cache/last_transcript.json',
            data: JSON.stringify(data),
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });
        console.log("✅ [API Cache] Saved last transcript to FS");
    } catch (e) {
        console.warn("❌ [API Cache] Save Failed", e);
    }
}

export async function getTranscriptById(id: string): Promise<{ url: string; segments: TranscriptSegment[]; title?: string; id: string; waveform_data?: any } | null> {
    try {
        const record = await pb.collection('transcripts').getOne(id);

        // 🔥 FIX: 使用 text 字段并解析，而不是直接读取 transcript_data
        const { materialService } = await import('./materialService');
        const segments = record.text ? materialService.parseTranscript(record.text) : [];

        return {
            url: record.audio_url || pb.files.getUrl(record, record.audio),
            segments: segments,
            title: record.title,
            id: record.id,
            waveform_data: record.waveform_data  // 🔥 确保返回波形数据
        };
    } catch (e) {
        console.warn("Failed to get transcript by ID", e);
        return null;
    }
}

// Strategy: The previous call replaced 148-263.
// The new content ended with `updateUserProgress`.
// I missing `silentLogin` and `fetchUserProgress`.
// I will insert them back.

export async function silentLogin(userId: string): Promise<boolean> {
    if (!userId) return false;

    const deriveSilentCredentials = (rawId: string, suffix: string = 'Pw2026') => {
        // Deterministic and PB-safe credentials for RC anonymous IDs like `$RCAnonymousID:xxxx`.
        let hash = 2166136261;
        for (let i = 0; i < rawId.length; i++) {
            hash ^= rawId.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        const h = (hash >>> 0).toString(16).padStart(8, '0');
        const compact = rawId
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(-20);

        const username = `rc_${compact}${h}`.slice(0, 40);
        // Supports legacy recovery by allowing different suffixes
        const password = `Rc#${h}${compact}#${suffix}`; 
        return { username, password };
    };

    const { username: safeUsername, password: safePassword } = deriveSilentCredentials(userId, 'Pw2026');
    const { password: oldPassword2025 } = deriveSilentCredentials(userId, 'Pw2025');

    // 1. Try strategies in order of likelihood
    const strategies = [
        { u: safeUsername, p: safePassword, label: 'Stable' },
        { u: userId, p: userId, label: 'Legacy' },
        { u: safeUsername, p: oldPassword2025, label: 'Transitional-2025' }
    ];

    console.log(`📡 [SilentLogin] Starting auth for ${userId.slice(0, 10)}...`);

    for (const strat of strategies) {
        try {
            await pb.collection('users').authWithPassword(strat.u, strat.p);
            console.log(`✅ [SilentLogin] Success (Strategy: ${strat.label})`);
            return true;
        } catch (err) {
            // Continue to next strategy
        }
    }

    // 2. If all auth failed, try to CREATE new account
    try {
        const { RELEASE_NOTES } = await import('@/data/releaseNotes');
        await pb.collection('users').create({
            username: safeUsername,
            password: safePassword,
            passwordConfirm: safePassword,
            revenue_id: userId,
            last_active_version: RELEASE_NOTES.version
        });
        await pb.collection('users').authWithPassword(safeUsername, safePassword);
        console.log("✅ [SilentLogin] New account created and logged in");
        return true;
    } catch (createErr: any) {
        // 3. 🆘 RESCUE: If creation fails because revenue_id exists, 
        // it means user has an account with a password we haven't tried yet.
        if (createErr.data?.data?.revenue_id?.code === 'validation_not_unique' || 
            createErr.data?.data?.username?.code === 'validation_not_unique') {
            
            console.warn("⚠️ [SilentLogin] Account exists but initial auth failed. Running deep rescue...");
            try {
                // Find the record by unique revenue_id
                const existing = await pb.collection('users').getFirstListItem(`revenue_id="${userId}"`);
                
                // Try all known password combinations against THIS specific username
                const rescuePasswords = [safePassword, userId, oldPassword2025];
                for (const p of rescuePasswords) {
                    try {
                        await pb.collection('users').authWithPassword(existing.username, p);
                        console.log("✅ [SilentLogin] Rescue login success with alternate password");
                        
                        // 🔥 SELF-HEALING: Upgrade this user's password to the latest stable one
                        await pb.collection('users').update(existing.id, {
                            password: safePassword,
                            passwordConfirm: safePassword
                        });
                        console.log("🆙 [SilentLogin] Upgraded user password to stable scheme");
                        return true;
                    } catch { /* try next */ }
                }
            } catch (rescueErr) {
                console.error("❌ [SilentLogin] Rescue failed: record not found or server error", rescueErr);
            }
        }
        console.error("❌ [SilentLogin] All login and rescue attempts failed", createErr);
        return false;
    }
}


export async function fetchUserProgress() {
    if (!pb.authStore.isValid) return [];
    try {
        return await pb.collection('user_progress').getFullList({
            filter: `user = "${pb.authStore.model?.id}"`,
        });
    } catch (e) {
        console.error("Failed to fetch user progress", e);
        return [];
    }
}

export async function getUserTranscripts(): Promise<any[]> {
    try {
        const userId = pb.authStore.model?.id;
        const records = await pb.collection('transcripts').getFullList({
            sort: '-created',
            filter: `owner="${userId}"` // Ensure we only get own transcripts
        });

        // Fetch progress for these materials
        let progressMap: Record<string, any> = {};
        if (userId) {
            try {
                const progressList = await pb.collection('user_progress').getFullList({
                    filter: `user="${userId}"`
                });
                for (const p of progressList) {
                    progressMap[p.material_id] = p;
                }
            } catch (e) { /* ignore */ }
        }

        return records.map(record => {
            // 🔍 CHECK FOR SERVER DOWNLOAD FAILURE (Fail-Safe)
            let transcriptData: any = [];
            const fullText = (typeof record.text === 'object') ? JSON.stringify(record.text) : (record.text || "");
            try {
                transcriptData = JSON.parse(fullText);
            } catch { transcriptData = []; }

            const segments = parseAliyunTranscript(transcriptData);
            const userProg = progressMap[record.id];

            return {
                id: record.id, // Use raw ID for matching
                title: record.audio,
                subtitle: new Date(record.created).toLocaleDateString(),
                imageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop', // Default
                duration: '00:00',
                label: { text: 'My Upload', type: 'new' },
                audioUrl: pb.files.getUrl(record, record.audio),
                transcript: segments,
                isUserUpload: true,
                userMeta: {
                    isStarred: userProg?.is_starred || false,
                    isPinned: userProg?.is_pinned || false,
                    currentStep: userProg?.current_step || 0,
                    isOffline: false
                }
            };
        });

    } catch (e) {
        console.error("Failed to fetch user transcripts", e);
        return [];
    }
}

export async function updateUserProgress(materialId: string, data: { is_starred?: boolean, is_pinned?: boolean, current_step?: number, marked_words?: any[] }) {
    console.log(`[Progress Update] Called for material: ${materialId}, data:`, data, `Auth valid: ${pb.authStore.isValid}`);

    if (!pb.authStore.isValid) {
        console.warn(`[Progress Update] ⚠️ Skipped - auth not valid for material: ${materialId}`);
        return;
    }
    try {
        // 1. Check if record exists
        const userId = pb.authStore.model?.id;
        let record;
        try {
            // Check if materialId is prefixed with 'user-' (legacy frontend compatibility)
            // If so, strip it, because DB stores raw ID.
            const rawId = materialId.startsWith('user-') ? materialId.replace('user-', '') : materialId;

            record = await pb.collection('user_progress').getFirstListItem(`user="${userId}" && material_id="${rawId}"`);

            // Sticky Step Logic
            if (data.current_step !== undefined) {
                const existingStep = record.current_step || 0;
                if (data.current_step <= existingStep) {
                    delete data.current_step; // Don't downgrade
                }
            }

            await pb.collection('user_progress').update(record.id, data);
            console.log(`[Progress Update] ✅ Updated existing record for ${materialId}:`, data);
        } catch (e) {
            // Create new - 这是首次访问这个材料
            const rawId = materialId.startsWith('user-') ? materialId.replace('user-', '') : materialId;
            console.log(`[Progress Update] Creating new record for ${materialId}`);
            await pb.collection('user_progress').create({
                user: userId,
                material_id: rawId,
                ...data
            });
            console.log(`[Progress Update] ✅ Created new record for ${materialId}:`, data);

            // 🔥 FIX: 异步计数 - 使用fire-and-forget模式确保绝不阻塞progress创建和播放
            if (data.current_step === 1) {
                // 使用Promise.resolve().then()确保计数逻辑在下一个事件循环执行
                // 这样即使查询失败或延迟,也绝对不会影响当前的progress创建流程
                Promise.resolve().then(async () => {
                    try {
                        const user = await pb.collection('users').getOne(userId!);
                        if (user.subscription_tier === 'free' || !user.subscription_tier) {
                            const count = user.materials_read_count || 0;
                            await pb.collection('users').update(userId!, {
                                materials_read_count: count + 1
                            });
                            console.log(`[Free Limit] ✅ Incremented count: ${count} -> ${count + 1} for material ${materialId}`);
                        }
                    } catch (countError) {
                        console.error('[Free Limit] Failed to increment count:', countError);
                        // Fire-and-forget: 完全独立,失败不影响任何流程
                    }
                });
            }
        }
    } catch (e) {
        console.error("Failed to update user progress", e);
        console.error("Material ID:", materialId);
        console.error("Update data:", data);
        console.error("Error details:", JSON.stringify(e, null, 2));
    }
}

export async function deleteUserData() {
    try {
        const userId = pb.authStore.model?.id;
        if (!pb.authStore.isValid || !userId) {
            console.warn("⚠️ [DeleteData] Not logged in, only clearing local cache.");
            return;
        }

        // 1. Delete progress
        const progress = await pb.collection('user_progress').getFullList({ filter: `user="${userId}"` });
        for (const p of progress) {
            await pb.collection('user_progress').delete(p.id);
        }

        // 2. Delete private materials
        const privateMaterials = await pb.collection('transcripts').getFullList({ filter: `owner="${userId}"` });
        for (const m of privateMaterials) {
            await pb.collection('transcripts').delete(m.id);
        }

        // 3. Delete User account
        await pb.collection('users').delete(userId);
        console.log("🗑️ [DeleteData] Server-side data deleted successfully");
    } catch (e) {
        console.error("❌ [DeleteData] Server-side deletion failed", e);
    } finally {
        // 4. ALWAYS Clear local storage & preferences
        pb.authStore.clear();
        await Preferences.clear();
        console.log("🧹 [DeleteData] Local storage and auth cleared");
    }
}


export async function fetchSystemConfig(key: string) {
    try {
        const record = await pb.collection('system_config').getFirstListItem(`key="${key}"`);

        // 🛡️ Auto-parse if it's a string looking like JSON (Array or Object)
        if (typeof record.value === 'string' && (record.value.startsWith('[') || record.value.startsWith('{'))) {
            try {
                return JSON.parse(record.value);
            } catch (e) {
                // Return raw string if parse fails
                return record.value;
            }
        }

        return record.value;
    } catch (e) {
        // console.warn(`Failed to fetch system config for key: ${key}`, e); // Silence 404s
        return null;
    }
}
