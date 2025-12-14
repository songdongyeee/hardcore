import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, '../src/data/dictionary.json');
// Path to the installed ecdict data
const dictDataPath = path.join(__dirname, '../node_modules/ecdict/data/dict.json');

console.log('Loading Dictionary...');

if (!fs.existsSync(dictDataPath)) {
    console.error(`Could not find dictionary data at ${dictDataPath}`);
    process.exit(1);
}

try {
    const rawData = fs.readFileSync(dictDataPath, 'utf-8');
    const allWords = JSON.parse(rawData);

    console.log(`Loaded ${allWords.length} words. Filtering...`);

    const entries = [];

    for (const item of allWords) {
        if (!item.word || !item.translation) continue;

        // Parse ranks (lower is better, 0 means unranked/unknown)
        const bnc = parseInt(item.bnc, 10);
        const frq = parseInt(item.frq, 10); // COCA frequency rank

        // Valid rank?
        if (isNaN(bnc)) continue; // Basic sanity check

        // Determine effective rank for sorting.
        // We prioritize COCA (frq).
        let rank = Infinity;
        if (frq > 0) rank = frq;
        else if (bnc > 0) rank = bnc;

        // If unranked, we might skip or put at end.
        // For top 20k, we strictly want popular words.
        if (rank === Infinity) continue;

        // Extract definitions from translation string
        // Format: "n. definition\nv. definition..." or "[tag] translation"
        const translation = item.translation.replace(/\\n/g, '\n');
        const defLines = translation.split('\n').map(s => s.trim()).filter(Boolean);

        entries.push({
            word: item.word,
            phonetic: item.phonetic,
            meanings: [{ partOfSpeech: 'general', definitions: defLines }],
            rank: rank
        });
    }

    // Sort by rank ascending (1 = most frequent)
    entries.sort((a, b) => a.rank - b.rank);

    // Top 20,000
    const topWords = entries.slice(0, 20000);

    // Convert to dictionary map
    const dictMap = {};
    topWords.forEach(e => {
        const key = e.word.toLowerCase();
        // If duplicate (e.g. case variants), keep the one with better rank or first seen?
        // Since we sorted by rank, first seen is better.
        if (!dictMap[key]) {
            dictMap[key] = {
                word: e.word,
                phonetic: e.phonetic ? `/${e.phonetic}/` : '',
                meanings: e.meanings
            };
        }
    });

    const count = Object.keys(dictMap).length;
    console.log(`Extracted ${count} words.`);

    fs.writeFileSync(jsonPath, JSON.stringify(dictMap)); // Minified for size
    console.log(`Saved to ${jsonPath}`);

    const stats = fs.statSync(jsonPath);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

} catch (err) {
    console.error('Error processing dictionary:', err);
    process.exit(1);
}
