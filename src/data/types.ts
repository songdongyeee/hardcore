import type { TranscriptSegment } from "./transcript";

export type Difficulty = 'L1' | 'L2' | 'L3';
export type MaterialLocation = 'daily_spark' | 'core_library';
export type MaterialVisibility = 'public' | 'private';

export interface Material {
    id: string;               // Unique Identifier
    source: 'bundled' | 'remote'; // Source: Local or PB
    location: MaterialLocation;
    title: string;
    title_translate?: string; // Chinese translation of title
    subtitle?: string;
    audioUrl: string;         // Web URL or Local File Path
    coverUrl: string;
    transcript: TranscriptSegment[];
    visibility?: MaterialVisibility;
    createdAt?: string; // ISO date string for sorting
    tags: {
        topic?: string;
        difficulty?: Difficulty;
        duration: string;
    };
    customOrder?: number; // 🔥 NEW: Admin custom order (higher = top)
    waveform_data?: number[][]; // Waveform visualization data [[min, max], ...]
    userMeta?: UserProgress;
    isNew?: boolean; // Trigger slide-in animation for newly uploaded materials
}

export interface UserProgress {
    isStarred: boolean;
    isPinned?: boolean;
    currentStep: number; // 0: new, 1: listening, 2: analysis, 3: shadowing
    isOffline: boolean;
    lastPlayed?: string;
    updatedAt?: string; // Time when isPinned or progress was last changed
}

export interface BundledCatalog {
    version: number;
    materials: Omit<Material, 'source' | 'userMeta'>[];
}
