import { useState, useEffect } from 'react';
import { Preferences } from '@capacitor/preferences';

const STORAGE_KEY = 'daily_usage_record';
const MAX_FREE_DAILY = 2;

// Export for managing account deletion
export const clearUsageRecord = async () => {
    await Preferences.remove({ key: STORAGE_KEY });
};

interface DailyRecord {
    date: string; // YYYY-MM-DD
    count: number;
    readIds: string[];
}

export function useUsageLimit(isVip: boolean) {
    const [record, setRecord] = useState<DailyRecord>({ date: '', count: 0, readIds: [] });
    // const [isBlocked, setIsBlocked] = useState(false); // Unused for now, logic is in checkAccess

    useEffect(() => {
        loadRecord();
    }, []);

    const getTodayDate = () => new Date().toISOString().split('T')[0];

    const loadRecord = async () => {
        const { value } = await Preferences.get({ key: STORAGE_KEY });
        const today = getTodayDate();

        if (value) {
            const parsed: DailyRecord = JSON.parse(value);
            if (parsed.date !== today) {
                // New Day: Reset
                const newRecord = { date: today, count: 0, readIds: [] };
                await saveRecord(newRecord);
            } else {
                setRecord(parsed);
            }
        } else {
            // Init
            const newRecord = { date: today, count: 0, readIds: [] };
            await saveRecord(newRecord);
        }
    };

    const saveRecord = async (newRecord: DailyRecord) => {
        setRecord(newRecord);
        await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(newRecord) });
    };

    /**
     * Check access for articleId. 
     * Returns object { allowed: boolean, reason: 'vip' | 'repeat' | 'quota' | 'blocked' }
     */
    const checkAccess = async (articleId: string) => {
        // 1. VIP -> Always allow
        if (isVip) return { allowed: true, reason: 'vip' };

        // Reload latest state to ensure sync
        const { value } = await Preferences.get({ key: STORAGE_KEY });
        const today = getTodayDate();
        let currentRecord = value ? JSON.parse(value) : { date: today, count: 0, readIds: [] };

        // 2. Date Check (Just in case app stayed open across midnight)
        if (currentRecord.date !== today) {
            currentRecord = { date: today, count: 0, readIds: [] };
            await saveRecord(currentRecord);
        }

        // 3. Repeat Check
        if (currentRecord.readIds.includes(articleId)) {
            return { allowed: true, reason: 'repeat' };
        }

        // 4. Quota Check
        if (currentRecord.count < MAX_FREE_DAILY) {
            // Consume Quota
            const updated = {
                ...currentRecord,
                count: currentRecord.count + 1,
                readIds: [...currentRecord.readIds, articleId]
            };
            await saveRecord(updated);
            return { allowed: true, reason: 'quota' };
        }

        // 5. Blocked
        return { allowed: false, reason: 'blocked' };
    };

    return {
        remaining: MAX_FREE_DAILY - record.count,
        isBlocked: record.count >= MAX_FREE_DAILY,
        checkAccess
    };
}
