#!/usr/bin/env node
/**
 * Patch one bundled material's transcriptRaw in src/data/generated_bundled_data.ts
 *
 * Usage:
 *   node scripts/patch_bundled_transcript.js --list
 *   node scripts/patch_bundled_transcript.js --file "ShangWenJie_CGTN.m4a" --json /tmp/fixed.json
 *   node scripts/patch_bundled_transcript.js --id dodlr2mtacsbpi8 --json /tmp/fixed.json
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const BUNDLED_PATH = path.join(ROOT, "src/data/generated_bundled_data.ts");
const PREFIX = "export const GENERATED_BATCH_DATA = ";

function parseArgs(argv) {
  const out = { list: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--list") {
      out.list = true;
    } else if (a === "--file") {
      out.fileName = argv[++i];
    } else if (a === "--id") {
      out.id = argv[++i];
    } else if (a === "--json") {
      out.jsonPath = argv[++i];
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

function loadBundledArray(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const start = content.indexOf(PREFIX);
  if (start < 0) throw new Error("Cannot find GENERATED_BATCH_DATA export.");

  const body = content.slice(start + PREFIX.length);
  const end = body.lastIndexOf(";");
  if (end < 0) throw new Error("Cannot find end ';' for GENERATED_BATCH_DATA.");

  const arrLiteral = body.slice(0, end).trim();
  let data;
  try {
    // eslint-disable-next-line no-new-func
    data = Function(`return (${arrLiteral});`)();
  } catch (e) {
    throw new Error(`Failed to parse bundled array: ${e.message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error("GENERATED_BATCH_DATA is not an array.");
  }
  return data;
}

function validateTranscriptRoot(v) {
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error("Input JSON must be a non-empty array root.");
  }
  const root = v[0];
  if (!root || typeof root !== "object" || !Array.isArray(root.sentences)) {
    throw new Error("Input JSON root[0].sentences is missing.");
  }
}

function writeBundledArray(filePath, data) {
  const next = `${PREFIX}${JSON.stringify(data)};\n`;
  fs.writeFileSync(filePath, next, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const data = loadBundledArray(BUNDLED_PATH);

  if (args.list) {
    const rows = data.map((it, i) => ({
      index: i,
      fileName: it.fileName || "",
      id: it.id || "",
      title: it.title || "",
    }));
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (!args.jsonPath) {
    throw new Error("Missing --json <path>");
  }
  if (!args.fileName && !args.id) {
    throw new Error("Missing target: use --file <fileName> or --id <id>");
  }

  const absJson = path.isAbsolute(args.jsonPath)
    ? args.jsonPath
    : path.join(ROOT, args.jsonPath);
  const inputText = fs.readFileSync(absJson, "utf8");
  const inputJson = JSON.parse(inputText);
  validateTranscriptRoot(inputJson);

  const idx = data.findIndex((it) => {
    if (args.fileName && it.fileName === args.fileName) return true;
    if (args.id && it.id === args.id) return true;
    return false;
  });

  if (idx < 0) {
    throw new Error("Target item not found in bundled data.");
  }

  const oldRaw = data[idx].transcriptRaw;
  let oldSentences = 0;
  try {
    const oldJson = typeof oldRaw === "string" ? JSON.parse(oldRaw) : oldRaw;
    oldSentences = oldJson?.[0]?.sentences?.length || 0;
  } catch (_) {
    oldSentences = 0;
  }

  const newSentences = inputJson?.[0]?.sentences?.length || 0;
  data[idx].transcriptRaw = JSON.stringify(inputJson);

  // 🔥 Update duration
  if (newSentences > 0) {
    const sentences = inputJson[0].sentences;
    const last = sentences[sentences.length - 1];
    const totalMs = last.end_time || 0;
    const totalSeconds = Math.ceil(totalMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const durationStr = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    data[idx].duration = durationStr;
    console.log(`[patch_bundled_transcript] Updated duration to ${durationStr}`);
  }

  writeBundledArray(BUNDLED_PATH, data);

  console.log(
    JSON.stringify(
      {
        ok: true,
        updatedIndex: idx,
        fileName: data[idx].fileName || "",
        id: data[idx].id || "",
        oldSentences,
        newSentences,
        file: BUNDLED_PATH,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (e) {
  console.error(`[patch_bundled_transcript] ${e.message}`);
  process.exit(1);
}
