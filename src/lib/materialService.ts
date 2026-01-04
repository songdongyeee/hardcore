import { pb, fetchUserProgress } from "./api";
import { BUNDLED_MATERIALS } from "@/data/bundled_materials";
import type { Material, UserProgress } from "@/data/types";
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import writeBlob from 'capacitor-blob-writer';

const MEDIA_DIR = 'media';
const IMAGES_DIR = 'images';
const SNAPSHOT_KEY = 'materials_snapshot_v1';

export const materialService = {
    /**
     * Loads the last known good state from local storage for instant render
     * 🎯 只返回Core Library材料，Daily Spark每天都会变不应缓存
     */
    async getCachedSnapshot(): Promise<Material[] | null> {
        try {
            const { value } = await Preferences.get({ key: SNAPSHOT_KEY });
            if (!value) return null;
            const materials = JSON.parse(value);
            // 过滤掉Daily Spark，因为它每天都会变
            return materials.filter((m: Material) => m.location === 'core_library');
        } catch (e) {
            return null;
        }
    },

    /**
     * Saves current materials to local storage. 
     * This ALWAYS overwrites the previous snapshot, so it never grows in size.
     * 🎯 只保存Core Library材料，Daily Spark每天都会变不需要缓存
     */
    async saveSnapshot(materials: Material[]): Promise<void> {
        try {
            // 只保存Core Library（Daily Spark每天都会变）
            const coreLibOnly = materials.filter(m => m.location === 'core_library');
            // Limits the snapshot to avoid extreme string lengths
            const limitedMaterials = coreLibOnly.slice(0, 100);
            await Preferences.set({
                key: SNAPSHOT_KEY,
                value: JSON.stringify(limitedMaterials)
            });
        } catch (e) {
            console.error("Failed to save snapshot", e);
        }
    },

    /**
     * Save transcript to local cache
     */
    async saveTranscriptCache(materialId: string, transcript: any[]): Promise<void> {
        try {
            await Preferences.set({
                key: `transcript_${materialId}`,
                value: JSON.stringify(transcript)
            });
            console.log(`✅ Cached transcript for ${materialId}`);
        } catch (e) {
            console.warn(`Failed to cache transcript for ${materialId}`, e);
        }
    },

    /**
     * Load transcript from local cache
     */
    async loadTranscriptCache(materialId: string): Promise<any[] | null> {
        try {
            const { value } = await Preferences.get({ key: `transcript_${materialId}` });
            if (!value) return null;
            return JSON.parse(value);
        } catch (e) {
            return null;
        }
    },

    /**
     * Maintenance: Clears all downloaded media files to free up space
     */
    async clearAllCache(): Promise<void> {
        try {
            await Promise.all([
                Filesystem.rmdir({ path: MEDIA_DIR, directory: Directory.Documents, recursive: true }).catch(() => { }),
                Filesystem.rmdir({ path: IMAGES_DIR, directory: Directory.Documents, recursive: true }).catch(() => { }),
                Preferences.remove({ key: SNAPSHOT_KEY })
            ]);
        } catch (e) {
            console.error("Cache cleanup failed", e);
        }
    },

    /**
     * Delete local files for a specific material
     */
    async deleteLocalFiles(id: string): Promise<void> {
        try {
            // Delete audio
            await Filesystem.deleteFile({
                path: `${MEDIA_DIR}/${id}.m4a`,
                directory: Directory.Documents
            }).catch(() => { }); // Ignore if not found

            // Delete cover image
            await Filesystem.deleteFile({
                path: `${IMAGES_DIR}/${id}.jpg`,
                directory: Directory.Documents
            }).catch(() => { }); // Ignore if not found

            console.log(`Deleted local files for ${id}`);
        } catch (e) {
            console.warn(`Failed to delete local files for ${id}`, e);
        }
    },

    /**
     * Daily Spark Rotation Logic
     * Returns the ID of the material to show for today.
     */
    async getDailySparkRotationId(candidates: Material[]): Promise<string | null> {
        if (!candidates || candidates.length === 0) return null;

        const STORAGE_KEY_DATE = 'daily_spark_date';
        const STORAGE_KEY_ID = 'daily_spark_id';
        const STORAGE_KEY_HISTORY = 'daily_spark_history';

        try {
            // 1. Get current state
            const { value: lastDateStr } = await Preferences.get({ key: STORAGE_KEY_DATE });
            const { value: currentId } = await Preferences.get({ key: STORAGE_KEY_ID });
            const { value: historyStr } = await Preferences.get({ key: STORAGE_KEY_HISTORY });

            const history: string[] = historyStr ? JSON.parse(historyStr) : [];
            const now = new Date();

            // Calculate "Today's 5:00 AM"
            const today5AM = new Date(now);
            today5AM.setHours(5, 0, 0, 0);

            // If now is before 5AM, we belong to "Yesterday's cycle" (so threshold is Yesterday 5AM)
            if (now < today5AM) {
                today5AM.setDate(today5AM.getDate() - 1);
            }

            const lastDate = lastDateStr ? new Date(lastDateStr) : new Date(0);

            // 2. logic: If we already have a valid ID for "today" (after 5AM), return it
            // Condition: last update was AFTER the 5AM threshold
            if (currentId && lastDate > today5AM) {
                // Ensure the ID still exists in candidates (it might have been deleted/hidden)
                return currentId;
                // If ID is gone, we need to pick a new one
            }

            // 3. Need to pick a new one!
            if (candidates.length < 3) return null;
            console.log("🔄 Rotating Daily Spark...");

            // Filter out history
            let available = candidates.filter(m => !history.includes(m.id));

            // If empty (Logic B: Reset), clear history and use all candidates
            if (available.length === 0) {
                console.log("⚠️ Daily Spark pool exhausted. Resetting history.");
                available = [...candidates];
                // We don't save cleared history yet, we append the new pick to a fresh history
                // effectively clearing the past.
            }

            // Random Pick (Logic A)
            const randomIndex = Math.floor(Math.random() * available.length);
            const pickedId = available[randomIndex].id;

            // 4. Update Storage
            const newHistory = available.length === candidates.length
                ? [pickedId] // Fresh cycle
                : [...history, pickedId]; // Append to existing

            await Promise.all([
                Preferences.set({ key: STORAGE_KEY_DATE, value: now.toISOString() }),
                Preferences.set({ key: STORAGE_KEY_ID, value: pickedId }),
                Preferences.set({ key: STORAGE_KEY_HISTORY, value: JSON.stringify(newHistory) })
            ]);

            return pickedId;

        } catch (e) {
            console.error("Failed to run rotation logic", e);
            // Fallback: Return first one
            return candidates[0].id;
        }
    },

    /**
     * Rapidly loads only bundled materials without any network or status check
     */
    getBundledOnly(): Material[] {
        return BUNDLED_MATERIALS.map(m => ({
            ...m,
            createdAt: (m as any).createdAt || '2020-01-01T00:00:00Z',
            userMeta: { isStarred: false, isPinned: false, currentStep: 0, isOffline: false, updatedAt: '2020-01-01T00:00:00Z' }
        }));
    },

    /**
     * Loads all materials (Bundled + Remote) and merges with user progress
     */
    async loadAllMaterials(): Promise<Material[]> {
        try {
            // 1. Fetch user progress from PB
            const progressList = await fetchUserProgress();
            console.log(`[MaterialService] Fetched ${progressList.length} user progress records`);
            const progressMap = new Map<string, UserProgress>();
            progressList.forEach((item: any) => {
                progressMap.set(item.material_id, {
                    isStarred: item.is_starred,
                    isPinned: item.is_pinned || false,
                    currentStep: item.current_step,
                    isOffline: false,
                    updatedAt: item.updated
                });
            });
            console.log(`[MaterialService] Progress map size: ${progressMap.size}`);


            // 2. Fetch System Config (Blacklist)
            let hiddenMaterials: string[] = [];
            try {
                // We import fetchSystemConfig dynamically or add it to imports if possible, 
                // but to avoid circular deps if api.ts imports types which materialService uses...
                // Ideally simpler:
                const { fetchSystemConfig } = await import('./api');
                const config = await fetchSystemConfig('hidden_materials');
                if (Array.isArray(config)) {
                    hiddenMaterials = config;
                }
            } catch (e) {
                console.warn('Failed to load system config', e);
            }

            // 3. Load Remote Materials from 'transcripts'
            let remoteMaterials: Material[] = [];
            if (pb.authStore.isValid) {
                const userId = pb.authStore.model?.id;
                // Fetch public OR owned by current user
                const records = await pb.collection('transcripts').getFullList({
                    filter: `(visibility = "public" || owner = "${userId}") && (status = "done" || status = "completed" || status = "ready" || status = "")`,
                    sort: '-created',
                });
                console.log(`[MaterialService] Fetched ${records.length} records from PocketBase`);
                if (records.length > 0) {
                    console.log('[MaterialService] Sample record:', records[0]);
                }

                remoteMaterials = await Promise.all(records.map(async record => {
                    const progress = progressMap.get(record.id);
                    const normalizedDate = record.created.replace(' ', 'T');

                    // 🔒 CRITICAL: Check local files FIRST to avoid server requests
                    const localAudio = await this.checkLocalFile(record.id, 'audio');
                    const localCover = await this.checkLocalFile(record.id, 'image');

                    // 🔥 FORCE RE-PARSE: Skip cache to ensure fixed timestamp parsing is applied
                    // Old cache may have incorrect end_time=0 due to previous bug
                    let transcript = null;
                    if (record.text) {
                        // Always parse from server data
                        transcript = this.parseTranscript(record.text);
                        // Update cache with correctly parsed data
                        if (transcript && transcript.length > 0) {
                            this.saveTranscriptCache(record.id, transcript);
                        }
                    }

                    return {
                        id: record.id,
                        source: 'remote',
                        location: record.location || 'core_library',
                        title: record.title || record.audio,
                        title_translate: record.title_translate,
                        subtitle: record.subtitle || new Date(normalizedDate).toLocaleDateString(),
                        // Use local path if exists, otherwise server URL
                        audioUrl: localAudio || pb.files.getUrl(record, record.audio),
                        coverUrl: localCover || (record.cover ? pb.files.getUrl(record, record.cover) : '/images/default_cover.png'),
                        transcript: transcript || [],
                        waveform_data: typeof record.waveform_data === 'string'
                            ? JSON.parse(record.waveform_data)
                            : record.waveform_data,
                        visibility: record.visibility,
                        createdAt: normalizedDate,
                        tags: {
                            topic: record.topic || 'General',
                            difficulty: record.difficulty || 'L1',
                            duration: record.duration || '00:00'
                        },
                        userMeta: progress || {
                            isStarred: false,
                            isPinned: false,
                            currentStep: 0,
                            isOffline: !!localAudio, // Mark as offline if local file exists
                            updatedAt: normalizedDate
                        }
                    };
                }));
            }

            // 4. Merge with Bundled (Filter out hidden ones)
            const activeBundled = BUNDLED_MATERIALS.filter(m => !hiddenMaterials.includes(m.id));

            const allMaterials: Material[] = await Promise.all([
                ...activeBundled.map(async m => {
                    return {
                        ...m,
                        createdAt: (m as any).createdAt || '2020-01-01T00:00:00Z',
                        userMeta: progressMap.get(m.id) || {
                            isStarred: false,
                            isPinned: false,
                            currentStep: 0,
                            isOffline: true, // Bundled is always offline
                            updatedAt: '2020-01-01T00:00:00Z'
                        }
                    };
                }),
                ...remoteMaterials
            ]);
            console.log(`[MaterialService] Total materials: ${allMaterials.length} (${activeBundled.length} bundled + ${remoteMaterials.length} remote)`);

            // 4. No need for additional local file check - already done above
            // 5. Persist to Snapshot with LOCAL URLs
            this.saveSnapshot(allMaterials);

            return allMaterials;
        } catch (e) {
            console.error("Failed to load materials", e);
            return BUNDLED_MATERIALS.map(m => ({ ...m, userMeta: { isStarred: false, isPinned: false, currentStep: 0, isOffline: false } }));
        }
    },

    async updateCachedSnapshot(currentMaterials: Material[]): Promise<void> {
        await this.saveSnapshot(currentMaterials);
    },

    /**
     * Check if a material's resource is already downloaded locally
     */
    async checkLocalFile(id: string, type: 'audio' | 'image' = 'audio'): Promise<string | null> {
        try {
            const dir = type === 'audio' ? MEDIA_DIR : IMAGES_DIR;

            if (type === 'audio') {
                const fileName = `${id}.m4a`;
                const result = await Filesystem.stat({ path: `${dir}/${fileName}`, directory: Directory.Documents });
                return Capacitor.convertFileSrc(result.uri);
            } else {
                // Only check jpg (most common format from PocketBase)
                // This reduces error logs significantly
                const fileName = `${id}.jpg`;
                const result = await Filesystem.stat({ path: `${dir}/${fileName}`, directory: Directory.Documents });
                return Capacitor.convertFileSrc(result.uri);
            }
        } catch (e) {
            // File doesn't exist - this is expected, return null silently
            return null;
        }
    },

    /**
     * Download and cache audio file locally
     */
    async downloadMaterial(materialId: string, url: string, coverUrl?: string): Promise<string | null> {
        try {
            // 1. Create directories
            await Promise.all([
                Filesystem.mkdir({ path: MEDIA_DIR, directory: Directory.Documents, recursive: true }).catch(() => { }),
                Filesystem.mkdir({ path: IMAGES_DIR, directory: Directory.Documents, recursive: true }).catch(() => { })
            ]);

            // 2. Download Image if provided
            if (coverUrl && !coverUrl.includes('default_cover')) {
                const ext = coverUrl.split('.').pop()?.split('?')[0] || 'jpg';
                this.downloadFile(coverUrl, `${IMAGES_DIR}/${materialId}.${ext}`).catch(e => console.error("Cover cache failed", e));
            }

            // 3. Download Audio
            return await this.downloadFile(url, `${MEDIA_DIR}/${materialId}.m4a`);
        } catch (e) {
            console.error("Download failed", e);
            return null;
        }
    },

    async downloadFile(url: string, path: string): Promise<string | null> {
        try {
            // Note: path includes MEDIA_DIR (e.g. 'media/xxx.m4a')
            // writeBlob needs the directory and the path. 
            // It uses the Web Filesystem API under the hood or native bridge.
            // But wait, capacitor-blob-writer takes 'path' relative to 'directory'.

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

            const blob = await response.blob();

            // Use capacitor-blob-writer which handles large files much better than base64 bridge
            await writeBlob({
                path: path,
                directory: Directory.Documents,
                blob: blob,
                recursive: true, // Creates parent directories automatically
                fast_mode: true  // Use experimental fast write if available
            });

            // Double check file exists and get URI
            const result = await Filesystem.stat({
                path: path,
                directory: Directory.Documents
            });

            return Capacitor.convertFileSrc(result.uri);
        } catch (e) {
            console.error(`Download failed for ${url}`, e);
            return null;
        }
    },

    /**
     * Helper to parse and normalize transcript JSON
     * Handles Aliyun format (start_time ms -> start s) and generates mock word timings if missing.
     */
    parseTranscript(text: any): any[] {
        if (!text) {
            return [];
        }

        try {
            const rawData = typeof text === 'string' ? JSON.parse(text) : text;

            // Extract sentences from Aliyun format: [{ "channel_id":0, "sentences":[...] }]
            let sentences = [];
            if (Array.isArray(rawData) && rawData[0]?.sentences) {
                sentences = rawData[0].sentences;
            } else if (Array.isArray(rawData)) {
                sentences = rawData;
            } else if (rawData.transcripts) {
                sentences = rawData.transcripts;
            }

            const result = sentences.map((s: any) => {
                // Handle begin_time/end_time (Aliyun) or start_time/end_time - convert from ms to s
                let start = s.begin_time !== undefined ? s.begin_time / 1000 :
                    s.start_time !== undefined ? s.start_time / 1000 :
                        s.start !== undefined ? s.start : 0;

                let end = s.end_time !== undefined ? s.end_time / 1000 :
                    s.end !== undefined ? s.end : start;

                const textContent = s.text || "";

                // Handle Words - Merge punctuation into word text
                let words = [];
                if (s.words && Array.isArray(s.words) && s.words.length > 0) {
                    // Case A: Words exist (Aliyun format with begin_time/end_time)
                    words = s.words.map((w: any) => {
                        const wordStart = w.begin_time !== undefined ? w.begin_time / 1000 :
                            w.start_time !== undefined ? w.start_time / 1000 :
                                w.start !== undefined ? w.start : 0;
                        const wordEnd = w.end_time !== undefined ? w.end_time / 1000 :
                            w.end !== undefined ? w.end : wordStart; // Fallback to wordStart, not 0

                        return {
                            text: w.text + (w.punctuation || ''),
                            start: wordStart,
                            end: wordEnd
                        };
                    });
                } else {
                    // Case B: Words missing - Generate Mock Timings for Karaoke
                    const rawWords = textContent.split(' ');
                    const duration = end - start;
                    const wordDuration = duration / Math.max(rawWords.length, 1);

                    words = rawWords.map((word: string, i: number) => ({
                        text: word,
                        start: start + (i * wordDuration),
                        end: start + ((i + 1) * wordDuration)
                    }));
                }

                return {
                    start,
                    end,
                    text: textContent,
                    translation: s.translation,
                    words
                };
            });

            return result;
        } catch (e) {
            console.error("❌ Transcript parse error", e);
            return [];
        }
    },

    /**
     * 轻量级加载今日Daily Spark材料（只加载ID列表 + 1条完整数据）
     */
    async loadDailySparkMaterials(progressList?: any[]): Promise<Material[]> {
        try {
            // 1. 检查今天是否已经选择过
            const STORAGE_KEY_DATE = 'daily_spark_date';
            const STORAGE_KEY_ID = 'daily_spark_id';

            const { value: lastDateStr } = await Preferences.get({ key: STORAGE_KEY_DATE });
            const { value: cachedId } = await Preferences.get({ key: STORAGE_KEY_ID });

            // 🎯 改用日期字符串比较（更可靠）
            const now = new Date();
            const todayDateStr = now.toISOString().split('T')[0];  // "2024-12-30"
            const lastSelectedDateStr = lastDateStr ? new Date(lastDateStr).toISOString().split('T')[0] : '';

            console.log('📅 [Daily Spark] Date check:', {
                today: todayDateStr,
                lastSelected: lastSelectedDateStr,
                cachedId: cachedId,
                needsRefresh: todayDateStr !== lastSelectedDateStr
            });

            let selectedId = cachedId;

            // 2. 如果今天还没选择，或者日期不同，重新选择
            if (!selectedId || todayDateStr !== lastSelectedDateStr) {
                console.log('🔄 Selecting new Daily Spark for today');

                // 🎯 只获取ID列表（超轻量级 ~5KB）
                const idList = await this.getDailySparkIdList();


                if (idList.length === 0) {
                    // 如果没有远程Daily Spark，返回bundled的
                    return BUNDLED_MATERIALS
                        .filter(m => m.location === 'daily_spark')
                        .map(m => ({
                            ...m,
                            createdAt: (m as any).createdAt || '2020-01-01T00:00:00Z',
                            userMeta: { isStarred: false, isPinned: false, currentStep: 0, isOffline: false, updatedAt: '2020-01-01T00:00:00Z' }
                        }));
                }

                // 使用rotation逻辑选择一个ID
                selectedId = await this.selectDailySparkFromIds(idList);

                // 保存选择
                await Promise.all([
                    Preferences.set({ key: STORAGE_KEY_DATE, value: new Date().toISOString() }),
                    Preferences.set({ key: STORAGE_KEY_ID, value: selectedId })
                ]);

                console.log('✅ [Daily Spark] Selected new material:', selectedId);
            } else {
                console.log('✅ Using cached Daily Spark selection:', selectedId);
            }

            // 3. 🎯 只加载那一条完整材料（~20KB）- 传递progressList
            const material = await this.loadSingleMaterial(selectedId, progressList);

            if (!material) {
                console.warn('⚠️ [Daily Spark] Failed to load material:', selectedId);
                // 降级：返回bundled Daily Spark
                return BUNDLED_MATERIALS
                    .filter(m => m.location === 'daily_spark')
                    .map(m => ({
                        ...m,
                        createdAt: (m as any).createdAt || '2020-01-01T00:00:00Z',
                        userMeta: { isStarred: false, isPinned: false, currentStep: 0, isOffline: false, updatedAt: '2020-01-01T00:00:00Z' }
                    }));
            }

            // 合并bundled Daily Spark材料
            const bundledDailySpark = BUNDLED_MATERIALS
                .filter(m => m.location === 'daily_spark')
                .map(m => ({
                    ...m,
                    createdAt: (m as any).createdAt || '2020-01-01T00:00:00Z',
                    userMeta: { isStarred: false, isPinned: false, currentStep: 0, isOffline: false, updatedAt: '2020-01-01T00:00:00Z' }
                }));

            return [...bundledDailySpark, material];
        } catch (error) {
            console.error('Failed to load Daily Spark materials:', error);
            // 降级：返回bundled Daily Spark
            return BUNDLED_MATERIALS
                .filter(m => m.location === 'daily_spark')
                .map(m => ({
                    ...m,
                    createdAt: (m as any).createdAt || '2020-01-01T00:00:00Z',
                    userMeta: { isStarred: false, isPinned: false, currentStep: 0, isOffline: false, updatedAt: '2020-01-01T00:00:00Z' }
                }));
        }
    },

    /**
     * 分页加载材料（核心性能优化）
     */
    async loadMaterialsPage(
        page: number,
        perPage: number = 20,
        progressList?: any[]
    ): Promise<{
        items: Material[];
        totalPages: number;
        hasMore: boolean;
    }> {
        try {
            if (!pb.authStore.isValid) {
                return { items: [], totalPages: 0, hasMore: false };
            }

            const userId = pb.authStore.model?.id;

            // 🎯 使用 getList 代替 getFullList
            const result = await pb.collection('transcripts').getList(page, perPage, {
                filter: `(visibility = "public" || owner = "${userId}") && (status = "done" || status = "completed")`,
                sort: '-created',
            });

            // 获取用户进度 - 使用传入的或重新获取
            const userProgress = progressList || await fetchUserProgress();
            const progressMap = new Map(
                userProgress.map((item: any) => [item.material_id, {
                    isStarred: item.is_starred,
                    isPinned: item.is_pinned || false,
                    currentStep: item.current_step,
                    isOffline: false,
                    updatedAt: item.updated
                }])
            );

            // 转换记录
            const items = await Promise.all(
                result.items.map(async record => {
                    const progress = progressMap.get(record.id);
                    const normalizedDate = record.created.replace(' ', 'T');

                    // 检查本地缓存
                    const localAudio = await this.checkLocalFile(record.id, 'audio');
                    const localCover = await this.checkLocalFile(record.id, 'image');

                    // 解析文本
                    let transcript = null;
                    if (record.text) {
                        transcript = this.parseTranscript(record.text);
                        if (transcript?.length > 0) {
                            this.saveTranscriptCache(record.id, transcript);
                        }
                    }

                    return {
                        id: record.id,
                        source: 'remote' as const,
                        location: record.location || 'core_library',
                        title: record.title || record.audio,
                        title_translate: record.title_translate,
                        subtitle: record.subtitle || new Date(normalizedDate).toLocaleDateString(),
                        audioUrl: localAudio || pb.files.getUrl(record, record.audio),
                        coverUrl: localCover || (record.cover ? pb.files.getUrl(record, record.cover) : '/images/default_cover.png'),
                        transcript: transcript || [],
                        waveform_data: typeof record.waveform_data === 'string'
                            ? JSON.parse(record.waveform_data)
                            : record.waveform_data,
                        visibility: record.visibility,
                        createdAt: normalizedDate,
                        tags: {
                            topic: record.topic || 'General',
                            difficulty: record.difficulty || 'L1',
                            duration: record.duration || '00:00'
                        },
                        userMeta: progress || {
                            isStarred: false,
                            isPinned: false,
                            currentStep: 0,
                            isOffline: !!localAudio,
                            updatedAt: normalizedDate
                        }
                    };
                })
            );

            return {
                items,
                totalPages: result.totalPages,
                hasMore: page < result.totalPages
            };
        } catch (error) {
            console.error('Failed to load materials page:', error);
            // ⚠️ Propagate error so UI knows it failed (instead of returning empty list)
            throw error;
        }
    },

    /**
     * 智能合并材料列表（去重 + 保留顺序）
     */
    mergeMaterials(existing: Material[], newItems: Material[]): Material[] {
        const map = new Map<string, Material>();

        // 保留旧数据
        existing.forEach(m => map.set(m.id, m));

        // 合并新数据（覆盖更新）
        newItems.forEach(m => map.set(m.id, m));

        return Array.from(map.values());
    },

    /**
     * 批量预缓存封面图（后台静默下载）
     */
    async prefetchCovers(materials: Material[], maxCount: number = 20): Promise<void> {
        const targets = materials
            .filter(m => {
                // 只缓存远程图片
                if (!m.coverUrl || m.coverUrl.includes('default_cover')) return false;
                if (m.coverUrl.startsWith('capacitor://')) return false; // 已缓存
                return true;
            })
            .slice(0, maxCount);

        console.log(`[Prefetch] Starting to cache ${targets.length} covers...`);

        for (const material of targets) {
            try {
                const ext = material.coverUrl.split('.').pop()?.split('?')[0] || 'jpg';
                await this.downloadFile(
                    material.coverUrl,
                    `${IMAGES_DIR}/${material.id}.${ext}`
                );
                console.log(`[Prefetch] Cached cover: ${material.id}`);
            } catch (error) {
                // 静默失败，不影响用户
                console.warn(`[Prefetch] Failed to cache ${material.id}:`, error);
            }
        }

        console.log('[Prefetch] Cover caching complete');
    },

    /**
     * 只获取Daily Spark的ID列表（超轻量级请求 ~5KB）
     */
    async getDailySparkIdList(): Promise<string[]> {
        if (!pb.authStore.isValid) return [];

        try {
            const userId = pb.authStore.model?.id;

            const records = await pb.collection('transcripts').getList(1, 100, {
                filter: `location = "daily_spark" && (visibility = "public" || owner = "${userId}") && (status = "done" || status = "completed")`,
                sort: '-created',
                fields: 'id',
            });

            return records.items.map((r: any) => r.id);
        } catch (error) {
            console.error('Failed to get Daily Spark ID list:', error);
            return [];
        }
    },

    /**
     * 从ID列表中选择今日Daily Spark
     */
    async selectDailySparkFromIds(idList: string[]): Promise<string> {
        if (idList.length === 0) return '';

        const STORAGE_KEY_HISTORY = 'daily_spark_history';

        try {
            const { value: historyStr } = await Preferences.get({ key: STORAGE_KEY_HISTORY });
            const history: string[] = historyStr ? JSON.parse(historyStr) : [];

            let available = idList.filter(id => !history.includes(id));

            if (available.length === 0) {
                console.log('⚠️ Daily Spark pool exhausted. Resetting history.');
                available = [...idList];
            }

            const randomIndex = Math.floor(Math.random() * available.length);
            const pickedId = available[randomIndex];

            const newHistory = available.length === idList.length
                ? [pickedId]
                : [...history, pickedId];

            await Preferences.set({
                key: STORAGE_KEY_HISTORY,
                value: JSON.stringify(newHistory)
            });

            return pickedId;
        } catch (error) {
            console.error('Failed to select Daily Spark:', error);
            return idList[0];
        }
    },

    /**
     * 加载单条材料的完整数据（~20KB）
     */
    async loadSingleMaterial(materialId: string, progressList?: any[]): Promise<Material | null> {
        if (!pb.authStore.isValid || !materialId) return null;

        try {
            const record = await pb.collection('transcripts').getOne(materialId);

            // 使用传入的progressList或重新获取
            const userProgress = progressList || await fetchUserProgress();
            const progress = userProgress.find((p: any) => p.material_id === materialId);

            const normalizedDate = record.created.replace(' ', 'T');
            const localAudio = await this.checkLocalFile(record.id, 'audio');
            const localCover = await this.checkLocalFile(record.id, 'image');

            let transcript = null;
            if (record.text) {
                transcript = this.parseTranscript(record.text);
                if (transcript?.length > 0) {
                    this.saveTranscriptCache(record.id, transcript);
                }
            }

            return {
                id: record.id,
                source: 'remote' as const,
                location: record.location || 'daily_spark',
                title: record.title || record.audio,
                title_translate: record.title_translate,
                subtitle: record.subtitle || new Date(normalizedDate).toLocaleDateString(),
                audioUrl: localAudio || pb.files.getUrl(record, record.audio),
                coverUrl: localCover || (record.cover ? pb.files.getUrl(record, record.cover) : '/images/default_cover.png'),
                transcript: transcript || [],
                waveform_data: typeof record.waveform_data === 'string'
                    ? JSON.parse(record.waveform_data)
                    : record.waveform_data,
                visibility: record.visibility,
                createdAt: normalizedDate,
                tags: {
                    topic: record.topic || 'General',
                    difficulty: record.difficulty || 'L1',
                    duration: record.duration || '00:00'
                },
                userMeta: progress ? {
                    isStarred: progress.is_starred,
                    isPinned: progress.is_pinned || false,
                    currentStep: progress.current_step,
                    isOffline: !!localAudio,
                    updatedAt: progress.updated
                } : {
                    isStarred: false,
                    isPinned: false,
                    currentStep: 0,
                    isOffline: !!localAudio,
                    updatedAt: normalizedDate
                }
            };
        } catch (error) {
            console.error('Failed to load single material:', error);
            return null;
        }
    },

    /**
     * 获取今天5AM的时间戳
     */
    getToday5AM(): Date {
        const now = new Date();
        const today5AM = new Date(now);
        today5AM.setHours(5, 0, 0, 0);
        if (now < today5AM) {
            today5AM.setDate(today5AM.getDate() - 1);
        }
        return today5AM;
    }

};
