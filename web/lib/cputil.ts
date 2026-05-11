import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ThermalWidth } from './printer-config';

const PLATFORM = process.platform;
const ARCH = process.arch;
const BIN_DIR = path.join(process.cwd(), 'bin');

function resolveBinary(): string {
  if (PLATFORM === 'linux' && ARCH === 'x64') {
    return path.join(BIN_DIR, 'cputil-linux-x64');
  }
  if (PLATFORM === 'darwin') {
    return path.join(BIN_DIR, ARCH === 'arm64' ? 'cputil-darwin-arm64' : 'cputil-darwin-x64');
  }
  throw new Error(
    `cputil binary not available for ${PLATFORM}-${ARCH}. ` +
      `Build with: pnpm exec ./scripts/build-cputil.sh`,
  );
}

export async function renderMarkup(
  markup: string,
  width: ThermalWidth = 'thermal2',
): Promise<Uint8Array> {
  // cputil's HTTPS image fetch fails on Vercel runtime (libssl missing
  // legacy provider for EVP_rc2_cbc used in PKCS#12 cert handling). Pre-fetch
  // images here in Node and rewrite the markup to point at local /tmp paths,
  // which cputil reads happily.
  const { markup: prepared, tmpFiles } = await preFetchImages(markup);

  const id = randomUUID();
  const input = path.join('/tmp', `${id}.stm`);
  const output = path.join('/tmp', `${id}.bin`);

  await writeFile(input, prepared, 'utf-8');
  try {
    await runCputil([
      width,
      'dither',
      'scale-to-fit',
      'decode',
      'application/vnd.star.starprntcore',
      input,
      output,
    ]);
    return Uint8Array.from(await readFile(output));
  } finally {
    await Promise.allSettled([
      unlink(input),
      unlink(output),
      ...tmpFiles.map((f) => unlink(f)),
    ]);
  }
}

const REMOTE_IMAGE_URL_RE = /(url\s+)(https?:\/\/[^\s;\]]+)/g;

async function preFetchImages(
  markup: string,
): Promise<{ markup: string; tmpFiles: string[] }> {
  const tmpFiles: string[] = [];
  const urls = [...markup.matchAll(REMOTE_IMAGE_URL_RE)].map((m) => m[2]);
  if (urls.length === 0) return { markup, tmpFiles };

  // De-dupe so the same image is fetched once even if referenced multiple times.
  const uniq = Array.from(new Set(urls));
  const replacements = new Map<string, string>();

  await Promise.all(
    uniq.map(async (url) => {
      const ext =
        url.match(/\.(png|jpe?g|bmp|gif)(?:\?|$|#)/i)?.[1]?.toLowerCase() ??
        'bin';
      const localPath = path.join('/tmp', `${randomUUID()}.${ext}`);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`image fetch ${res.status} for ${url}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(localPath, buf);
      tmpFiles.push(localPath);
      replacements.set(url, localPath);
    }),
  );

  const replaced = markup.replace(REMOTE_IMAGE_URL_RE, (_full, prefix, url) => {
    return prefix + (replacements.get(url) ?? url);
  });

  return { markup: replaced, tmpFiles };
}

function runCputil(args: string[]): Promise<void> {
  const bin = resolveBinary();
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env: {
        ...process.env,
        // Vercel Lambda runtime ships without libicu; .NET refuses to start
        // unless we tell it to skip culture-aware globalization.
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
      },
    });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cputil exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    proc.on('error', reject);
  });
}
