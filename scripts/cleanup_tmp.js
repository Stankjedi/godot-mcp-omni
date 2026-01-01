import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function usage() {
  return [
    'Usage:',
    '  node scripts/cleanup_tmp.js [--dir <path>]',
    '',
    'Options:',
    '  --dir <path>   Directory to clean (default: .tmp)',
    '  --help, -h     Show this help and exit',
    '',
    'Behavior:',
    '  - Deletes only the contents of the provided directory.',
    '  - Does not delete anything outside that directory.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let dir = '.tmp';
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      help = true;
      continue;
    }
    if (a === '--dir') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --dir\n\n${usage()}`);
      }
      dir = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
  }

  return { dir, help };
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    console.log(usage());
    process.exit(0);
    return;
  }

  const targetDir = path.resolve(process.cwd(), parsed.dir);
  const exists = await pathExists(targetDir);
  if (!exists) {
    console.log(`No temp directory found: ${targetDir}`);
    process.exit(0);
    return;
  }

  const entries = await fs.readdir(targetDir);
  if (entries.length === 0) {
    console.log(`No temp artifacts to clean in: ${targetDir}`);
    process.exit(0);
    return;
  }

  const removed = [];
  for (const entry of entries) {
    const entryPath = path.join(targetDir, entry);
    await fs.rm(entryPath, { recursive: true, force: true });
    removed.push(entry);
  }

  const MAX_LIST = 20;
  const listed = removed.slice(0, MAX_LIST);

  console.log(`Deleted ${removed.length} entries from: ${targetDir}`);
  for (const name of listed) console.log(`- ${name}`);
  if (removed.length > listed.length) {
    console.log(`- ... (${removed.length - listed.length} more)`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
