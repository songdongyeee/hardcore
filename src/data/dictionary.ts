import dictionaryData from './dictionary.json';

export interface DictionaryEntry {
    word: string;
    phonetic: string;
    meanings: {
        partOfSpeech: string;
        definitions: string[];
    }[];
}

// Type assertion for the imported JSON to ensure it matches our structure
const dictionary: Record<string, DictionaryEntry> = dictionaryData as unknown as Record<string, DictionaryEntry>;

export const lookupWord = (word: string): DictionaryEntry | null => {
    if (!word) return null;

    // 1. Normalize
    const normalized = word.toLowerCase().replace(/[^a-z']/g, "");
    // We keep single quotes for words like "'hood" or "don't" (though "don't" might not be in dict)

    // 2. Exact match
    if (dictionary[normalized]) return dictionary[normalized];

    // 3. Basic Stemming / Lemmatization Heuristics
    // Plural / Third person 's'
    if (normalized.endsWith('s')) {
        const base = normalized.slice(0, -1);
        if (dictionary[base]) return dictionary[base];
        if (normalized.endsWith('es')) {
            const baseEs = normalized.slice(0, -2);
            if (dictionary[baseEs]) return dictionary[baseEs];
        }
    }

    // Past tense 'ed'
    if (normalized.endsWith('ed')) {
        const base = normalized.slice(0, -2); // waited -> wait
        if (dictionary[base]) return dictionary[base];
        const baseD = normalized.slice(0, -1); // danced -> dance
        if (dictionary[baseD]) return dictionary[baseD];
    }

    // Gerund 'ing'
    if (normalized.endsWith('ing')) {
        const base = normalized.slice(0, -3); // eating -> eat
        if (dictionary[base]) return dictionary[base];
        // running -> run (simplified check, might need rule for double consonant, but let's try dropping last char)
        // This is complex without a real lemmatizer, but we can try:
        // skipping complex rules for now as this is a simple local dict.
    }

    // irregulars (can expand this list later)
    const irregulars: Record<string, string> = {
        "better": "good",
        "best": "good",
        "worse": "bad",
        "worst": "bad",
        "came": "come",
        "went": "go",
        "gone": "go",
        "seen": "see",
        "saw": "see",
        "made": "make",
        "knew": "know",
        "known": "know",
        "took": "take",
        "taken": "take",
        "gave": "give",
        "given": "give",
        "found": "find",
        "got": "get",
        "gotten": "get",
        "told": "tell",
        "left": "leave",
        "thought": "think",
        "bought": "buy",
        "brought": "bring",
        "read": "read",
        "heard": "hear",
        "understood": "understand",
        "became": "become",
        "began": "begin",
        "begun": "begin",
        "stories": "story",
        "graduated": "graduate",
        "connecting": "connect",
        "dropped": "drop",
        "finest": "fine",
        "closest": "close",
        "biological": "biological",
        "unwed": "unwed",
        "adoption": "adoption"
    };

    if (irregulars[normalized] && dictionary[irregulars[normalized]]) {
        return dictionary[irregulars[normalized]];
    }

    return null;
};
