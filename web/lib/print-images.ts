import 'server-only';

// Remote images in markup (`[image: url https://...]`) used to be downloaded
// on EVERY printer GET. A slow host (the ~900 KB neil.co.th logo takes ~12s)
// pushed the GET past the printer's download timeout, the printer retried,
// each retry re-downloaded, and the job looped until it expired. Two cache
// layers fix that:
//  - Next's Data Cache (`force-cache`): shared across instances. Only 200
//    responses are stored, so a transient error never sticks. Entries over
//    2 MB are skipped by Next (the memo below still covers those).
//  - A per-instance memo: Fluid compute reuses instances, and concurrent GETs
//    for the same image share one in-flight download.
// warmImages() runs at enqueue time, so the printer's first GET usually hits
// a warm cache.

export const REMOTE_IMAGE_URL_RE = /(url\s+)(https?:\/\/[^\s;\]]+)/g;

const IMAGE_REVALIDATE_SEC = 24 * 60 * 60;
const MEMO_TTL_MS = IMAGE_REVALIDATE_SEC * 1000;
const MEMO_MAX = 32;

const memo = new Map<string, { at: number; bytes: Promise<Buffer> }>();

export function remoteImageUrls(markup: string): string[] {
  return Array.from(
    new Set([...markup.matchAll(REMOTE_IMAGE_URL_RE)].map((m) => m[2])),
  );
}

export function fetchImage(url: string): Promise<Buffer> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.bytes;

  const bytes = (async () => {
    const res = await fetch(url, {
      cache: 'force-cache',
      next: { revalidate: IMAGE_REVALIDATE_SEC },
    });
    if (!res.ok) {
      throw new Error(`image fetch ${res.status} for ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
  })();

  // Never memoize a failure: the printer's next GET should try again.
  bytes.catch(() => {
    if (memo.get(url)?.bytes === bytes) memo.delete(url);
  });

  memo.delete(url);
  memo.set(url, { at: Date.now(), bytes });
  if (memo.size > MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return bytes;
}

// Best-effort pre-download so the cache is warm before the printer asks.
// Errors are ignored here; the GET path reports them on the job.
export async function warmImages(markup: string): Promise<void> {
  await Promise.allSettled(remoteImageUrls(markup).map(fetchImage));
}
