import type { DictionaryEntry } from "@/data/dictionary";

const API_BASE = "https://freedictionaryapi.com/api/v1/entries/en";
const CACHE_PREFIX = "online_dictionary_entry_v5:";
const QUOTA_PREFIX = "online_dictionary_quota_v1:";
const BLOCK_KEY = "online_dictionary_block_until_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The provider allows 1,000 requests/hour/IP. Keep the app well below that per device.
const APP_HOURLY_LIMIT = 100;

const MANUAL_ENTRIES: Record<string, DictionaryEntry> = {
  rapsodes: {
    word: "rhapsodes",
    phonetic: "",
    meanings: [{ partOfSpeech: "noun", definitions: ["史诗吟诵者；古希腊吟游诗人"] }]
  },
  rhapsode: {
    word: "rhapsode",
    phonetic: "/ˈræpˌsoʊd/",
    meanings: [{ partOfSpeech: "noun", definitions: ["史诗吟诵者；古希腊吟游诗人"] }]
  },
  rhapsodes: {
    word: "rhapsodes",
    phonetic: "",
    meanings: [{ partOfSpeech: "noun", definitions: ["史诗吟诵者；古希腊吟游诗人"] }]
  }
};

const SPELLING_CANDIDATES: Record<string, string[]> = {
  rapsode: ["rhapsode"],
  rapsodes: ["rhapsode", "rhapsodes"]
};

interface CachedEntry {
  expiresAt: number;
  entry: DictionaryEntry | null;
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "");
}

function isLookupAllowed(word: string) {
  return /^[a-z][a-z'-]{1,39}$/i.test(word);
}

function buildLookupCandidates(word: string) {
  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    if (candidate && isLookupAllowed(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  SPELLING_CANDIDATES[word]?.forEach(addCandidate);

  if (word.includes("-")) addCandidate(word.replace(/-/g, ""));

  if (word.endsWith("'s")) addCandidate(word.slice(0, -2));
  if (word.endsWith("s'")) addCandidate(word.slice(0, -2));
  if (word.endsWith("ies") && word.length > 4) addCandidate(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 4) addCandidate(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 3) addCandidate(word.slice(0, -1));

  if (word.endsWith("ied") && word.length > 4) addCandidate(`${word.slice(0, -3)}y`);
  if (word.endsWith("ed") && word.length > 4) {
    addCandidate(word.slice(0, -2));
    addCandidate(word.slice(0, -1));
  }

  if (word.endsWith("ing") && word.length > 5) {
    const stem = word.slice(0, -3);
    addCandidate(stem);
    addCandidate(`${stem}e`);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) {
      addCandidate(stem.slice(0, -1));
    }
  }

  addCandidate(word);

  return candidates.slice(0, 8);
}

function currentQuotaKey() {
  const now = new Date();
  const hour = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  return `${QUOTA_PREFIX}${hour}`;
}

function readCache(word: string): DictionaryEntry | null | undefined {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${word}`);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CachedEntry;
    if (!cached || cached.expiresAt < Date.now()) {
      localStorage.removeItem(`${CACHE_PREFIX}${word}`);
      return undefined;
    }
    return cached.entry;
  } catch {
    return undefined;
  }
}

function writeCache(word: string, entry: DictionaryEntry | null) {
  try {
    const cached: CachedEntry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      entry
    };
    localStorage.setItem(`${CACHE_PREFIX}${word}`, JSON.stringify(cached));
  } catch {
    // Cache is an optimization only.
  }
}

function canSendRequest() {
  try {
    const blockedUntil = Number(localStorage.getItem(BLOCK_KEY) || 0);
    if (blockedUntil > Date.now()) return false;

    const key = currentQuotaKey();
    const count = Number(localStorage.getItem(key) || 0);
    return count < APP_HOURLY_LIMIT;
  } catch {
    return true;
  }
}

function markRequestSent() {
  try {
    const key = currentQuotaKey();
    const count = Number(localStorage.getItem(key) || 0);
    localStorage.setItem(key, String(count + 1));
  } catch {
    // Best effort quota accounting.
  }
}

function blockUntilNextHour() {
  const now = new Date();
  const nextHour = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
    1
  );
  try {
    localStorage.setItem(BLOCK_KEY, String(nextHour));
  } catch {
    // Best effort.
  }
}

function isChineseTranslation(item: any) {
  const code = String(item?.language?.code || "").toLowerCase();
  const name = String(item?.language?.name || "").toLowerCase();
  const word = String(item?.word || "").trim();

  if (!/[\u3400-\u9fff]/.test(word)) return false;
  return code === "zh" ||
    code === "cmn" ||
    name.includes("chinese") ||
    name.includes("mandarin");
}

function collectTranslations(sense: any): string[] {
  const direct = Array.isArray(sense?.translations) ? sense.translations : [];
  const subsenses = Array.isArray(sense?.subsenses) ? sense.subsenses : [];
  const translations = direct
    .filter(isChineseTranslation)
    .map((item: any) => String(item.word || "").replace(/\s*\/\s*/g, " / ").trim())
    .filter(Boolean);

  return [...translations, ...subsenses.flatMap(collectTranslations)];
}

function mapApiResult(data: any, fallbackWord: string): DictionaryEntry | null {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  if (entries.length === 0) return null;

  const meanings = entries
    .slice(0, 4)
    .map((entry: any) => {
      const definitions = (Array.isArray(entry.senses) ? entry.senses : [])
        .flatMap((sense: any) => {
          const translations = collectTranslations(sense);
          return translations;
        })
        .filter(Boolean)
        .filter((value: string, index: number, list: string[]) => list.indexOf(value) === index)
        .slice(0, 3);

      if (definitions.length === 0) return null;

      return {
        partOfSpeech: String(entry.partOfSpeech || "word"),
        definitions
      };
    })
    .filter(Boolean) as DictionaryEntry["meanings"];

  if (meanings.length === 0) return null;

  const pronunciation = entries
    .flatMap((entry: any) => Array.isArray(entry.pronunciations) ? entry.pronunciations : [])
    .find((item: any) => item?.type === "ipa" && item?.text)?.text || "";

  return {
    word: String(data?.word || fallbackWord),
    phonetic: pronunciation,
    meanings
  };
}

export async function lookupOnlineDictionary(rawWord: string): Promise<DictionaryEntry | null> {
  const word = normalizeWord(rawWord);
  if (!word || !isLookupAllowed(word)) return null;

  if (MANUAL_ENTRIES[word]) return MANUAL_ENTRIES[word];

  const cached = readCache(word);
  if (cached !== undefined) return cached;

  if (!canSendRequest()) return null;

  const candidates = buildLookupCandidates(word);

  for (const candidate of candidates) {
    if (!canSendRequest()) return null;
    markRequestSent();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(`${API_BASE}/${encodeURIComponent(candidate)}?translations=true`, {
        signal: controller.signal
      });

      if (response.status === 429) {
        blockUntilNextHour();
        return null;
      }

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const entry = mapApiResult(data, candidate);
      if (entry) {
        writeCache(word, entry);
        return entry;
      }
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return null;
}
