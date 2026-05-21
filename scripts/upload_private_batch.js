import fs from 'fs';
import path from 'path';
import PocketBase from 'pocketbase';
import { parseFile } from 'music-metadata';

const DEFAULTS = {
  collection: 'transcripts',
  location: 'core_library',
  visibility: 'private',
  language: 'en',
  asrEngine: '',
  topic: 'General',
  difficulty: 'L1',
  wait: false,
  pollIntervalMs: 3000,
  timeoutSec: 600,
  recursive: false,
  dryRun: false,
  reportPath: '',
  orderByNameNumber: false,
};

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac']);

function printHelp() {
  console.log(`
Batch private upload to PocketBase

Usage:
  node scripts/upload_private_batch.js --dir <folder> [options]

Required env:
  PB_URL
  PB_ADMIN_EMAIL
  PB_ADMIN_PASSWORD

Options:
  --dir <path>                Folder containing audio files (required)
  --collection <name>         PocketBase collection (default: transcripts)
  --location <value>          location field value (default: core_library)
  --visibility <value>        visibility field value (default: private)
  --language <value>          language field value (default: en)
  --asr-engine <value>        Optional asr_engine field value, e.g. whisper or aliyun
  --topic <value>             topic field value (default: General)
  --difficulty <value>        difficulty field value (default: L1)
  --owner <userId>            Optional owner relation id (recommended for private per-user)
  --recursive                 Scan subfolders recursively
  --dry-run                   Only scan and print plan; do not upload
  --wait                      Poll status until done/error after each upload
  --poll-interval <ms>        Poll interval when --wait is enabled (default: 3000)
  --timeout <sec>             Poll timeout per file when --wait is enabled (default: 600)
  --report <path>             Write JSON report to file (default: scripts/upload-report-<ts>.json)
  --order-by-name-number      Parse leading number in filename and write custom_order
  --help                      Show this help

Examples:
  node scripts/upload_private_batch.js --dir /abs/path/to/mp3s --dry-run
  node scripts/upload_private_batch.js --dir /abs/path/to/mp3s --owner USER_ID --wait
  node scripts/upload_private_batch.js --dir /abs/path/to/mp3s --order-by-name-number
`);
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--dir':
        opts.dir = next;
        i += 1;
        break;
      case '--collection':
        opts.collection = next;
        i += 1;
        break;
      case '--location':
        opts.location = next;
        i += 1;
        break;
      case '--visibility':
        opts.visibility = next;
        i += 1;
        break;
      case '--language':
        opts.language = next;
        i += 1;
        break;
      case '--asr-engine':
        opts.asrEngine = next;
        i += 1;
        break;
      case '--topic':
        opts.topic = next;
        i += 1;
        break;
      case '--difficulty':
        opts.difficulty = next;
        i += 1;
        break;
      case '--owner':
        opts.owner = next;
        i += 1;
        break;
      case '--poll-interval':
        opts.pollIntervalMs = Number(next);
        i += 1;
        break;
      case '--timeout':
        opts.timeoutSec = Number(next);
        i += 1;
        break;
      case '--report':
        opts.reportPath = next;
        i += 1;
        break;
      case '--recursive':
        opts.recursive = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--wait':
        opts.wait = true;
        break;
      case '--order-by-name-number':
        opts.orderByNameNumber = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return opts;
}

async function collectAudioFiles(rootDir, recursive) {
  const queue = [path.resolve(rootDir)];
  const files = [];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  files.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
  return files;
}

function toDurationLabel(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function inferTitle(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.flac') return 'audio/flac';
  return 'application/octet-stream';
}

function extractLeadingNumber(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const match = base.match(/^(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

async function getAudioMeta(filePath) {
  const stat = await fs.promises.stat(filePath);
  let durationSec = 0;

  try {
    const metadata = await parseFile(filePath);
    durationSec = Math.floor(metadata.format.duration || 0);
  } catch (_err) {
    durationSec = 0;
  }

  return {
    sizeBytes: stat.size,
    durationSec,
    durationLabel: toDurationLabel(durationSec),
  };
}

async function authenticate(pb, email, password) {
  try {
    const authData = await pb.send('/api/admins/auth-with-password', {
      method: 'POST',
      body: { identity: email, password },
    });
    pb.authStore.save(authData.token, authData.admin);
    return 'legacy_admin';
  } catch (_legacyErr) {
    try {
      await pb.collection('_superusers').authWithPassword(email, password);
      return 'superuser';
    } catch (_superuserErr) {
      await pb.collection('users').authWithPassword(email, password);
      return 'users_collection';
    }
  }
}

async function validateOwner(pb, ownerId) {
  try {
    const user = await pb.collection('users').getOne(ownerId, {
      fields: 'id,email,username',
    });
    return user;
  } catch (_err) {
    throw new Error(`Owner user not found: ${ownerId}`);
  }
}

async function waitForFinalStatus(pb, collection, recordId, pollIntervalMs, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const current = await pb.collection(collection).getOne(recordId);
    lastStatus = current.status || '';

    if (lastStatus === 'done' || lastStatus === 'completed' || lastStatus === 'ready') {
      return { finalStatus: lastStatus, timedOut: false };
    }

    if (lastStatus === 'error') {
      return { finalStatus: lastStatus, timedOut: false };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { finalStatus: lastStatus, timedOut: true };
}

function ensureEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.dir) {
    throw new Error('Missing required argument: --dir <folder>');
  }

  const targetDir = path.resolve(opts.dir);
  const exists = fs.existsSync(targetDir);
  if (!exists) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const files = await collectAudioFiles(targetDir, opts.recursive);
  if (files.length === 0) {
    console.log(`No audio files found in: ${targetDir}`);
    return;
  }

  console.log(`Found ${files.length} audio files in ${targetDir}`);

  const filePlans = [];
  let totalBytes = 0;

  for (const filePath of files) {
    const meta = await getAudioMeta(filePath);
    totalBytes += meta.sizeBytes;
    filePlans.push({
      filePath,
      fileName: path.basename(filePath),
      title: inferTitle(filePath),
      ...meta,
    });
  }

  if (opts.orderByNameNumber) {
    filePlans.sort((a, b) => {
      const numA = extractLeadingNumber(a.fileName);
      const numB = extractLeadingNumber(b.fileName);

      if (numA !== null && numB !== null && numA !== numB) return numA - numB;
      if (numA !== null && numB === null) return -1;
      if (numA === null && numB !== null) return 1;
      return a.fileName.localeCompare(b.fileName, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });

    const total = filePlans.length;
    for (let i = 0; i < filePlans.length; i += 1) {
      // HomeView sorts by customOrder DESC, so the first item gets highest value.
      filePlans[i].customOrder = total - i;
      filePlans[i].nameNumber = extractLeadingNumber(filePlans[i].fileName);
    }
  }

  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  for (const item of filePlans) {
    const orderText = opts.orderByNameNumber
      ? ` | num=${item.nameNumber ?? '-'} custom_order=${item.customOrder}`
      : '';
    console.log(
      `- ${item.fileName} | ${item.durationLabel} | ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB${orderText}`
    );
  }

  if (opts.dryRun) {
    console.log('\nDry-run finished. No uploads executed.');
    return;
  }

  const pbUrl = ensureEnv('PB_URL');
  const email = ensureEnv('PB_ADMIN_EMAIL');
  const password = ensureEnv('PB_ADMIN_PASSWORD');

  const pb = new PocketBase(pbUrl);
  const loginMode = await authenticate(pb, email, password);
  console.log(`Authenticated via: ${loginMode}`);

  if (opts.owner) {
    const ownerUser = await validateOwner(pb, opts.owner);
    console.log(
      `Owner validated: id=${ownerUser.id}, username=${ownerUser.username || '-'}, email=${ownerUser.email || '-'}`
    );
  }

  const results = [];

  for (let i = 0; i < filePlans.length; i += 1) {
    const item = filePlans[i];
    const indexLabel = `[${i + 1}/${filePlans.length}]`;
    console.log(`\n${indexLabel} Uploading: ${item.fileName}`);

    try {
      const buffer = await fs.promises.readFile(item.filePath);
      const blob = new Blob([buffer], { type: inferMime(item.filePath) });

      const formData = new FormData();
      formData.append('audio', blob, item.fileName);
      formData.append('title', item.title);
      formData.append('duration', item.durationLabel);
      formData.append('topic', opts.topic);
      formData.append('difficulty', opts.difficulty);
      formData.append('location', opts.location);
      formData.append('language', opts.language);
      formData.append('visibility', opts.visibility);
      if (opts.asrEngine) {
        formData.append('asr_engine', opts.asrEngine);
      }
      if (opts.orderByNameNumber) {
        formData.append('custom_order', String(item.customOrder));
      }

      if (opts.owner) {
        formData.append('owner', opts.owner);
      }

      const record = await pb.collection(opts.collection).create(formData);

      let finalStatus = record.status || '';
      let timedOut = false;

      if (opts.wait) {
        const waited = await waitForFinalStatus(
          pb,
          opts.collection,
          record.id,
          opts.pollIntervalMs,
          opts.timeoutSec
        );
        finalStatus = waited.finalStatus;
        timedOut = waited.timedOut;
      }

      results.push({
        fileName: item.fileName,
        path: item.filePath,
        recordId: record.id,
        created: record.created,
        visibility: record.visibility || opts.visibility,
        status: finalStatus,
        timedOut,
        ok: !timedOut && finalStatus !== 'error',
      });

      if (opts.wait) {
        console.log(`   record=${record.id} status=${finalStatus}${timedOut ? ' (timeout)' : ''}`);
      } else {
        console.log(`   record=${record.id} status=${finalStatus || 'created'}`);
      }
    } catch (error) {
      const message = error?.message || String(error);
      results.push({
        fileName: item.fileName,
        path: item.filePath,
        ok: false,
        error: message,
      });
      console.error(`   failed: ${message}`);
    }
  }

  const successCount = results.filter((x) => x.ok).length;
  const failedCount = results.length - successCount;

  console.log('\nUpload summary');
  console.log(`- total: ${results.length}`);
  console.log(`- success: ${successCount}`);
  console.log(`- failed: ${failedCount}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = opts.reportPath
    ? path.resolve(opts.reportPath)
    : path.resolve(process.cwd(), `scripts/upload-report-${timestamp}.json`);

  await fs.promises.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pbUrl,
        collection: opts.collection,
        location: opts.location,
        visibility: opts.visibility,
        language: opts.language,
        asr_engine: opts.asrEngine || null,
        topic: opts.topic,
        difficulty: opts.difficulty,
        owner: opts.owner || null,
        wait: opts.wait,
        sourceDir: targetDir,
        totalFiles: filePlans.length,
        results,
      },
      null,
      2
    )
  );

  console.log(`Report saved: ${reportPath}`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
