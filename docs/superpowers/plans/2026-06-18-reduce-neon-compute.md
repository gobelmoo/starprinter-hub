# Reduce Neon Compute (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลด Neon Free compute-hours ให้ต่ำกว่าเพดาน 191.9 hr/mo โดยรวมจังหวะการแตะ Postgres ตอน idle ให้เป็น heartbeat เดียว เพื่อให้ compute auto-suspend ได้ (และตัดการเก็บประวัติงานพิมพ์ที่สำเร็จเพื่อลด storage)

**Architecture:** การแตะ Postgres ตอน idle 2 อย่าง (อ่านสถานะ pending + เขียน last_seen) ถูก align เข้าหา cadence เดียวกันผ่าน "generation" ที่มาจาก Vercel Data Cache (shared ทุก instance, ฟรี ไม่กิน Neon) — cached `getPendingState()` คืน `{ pending, gen }`; `gen` เปลี่ยนทุกครั้งที่ cache refresh (ทุก HEARTBEAT_SEC) และ poll handler เขียน last_seen แบบ synchronous เฉพาะเมื่อ `gen` เปลี่ยน ทำให้การอ่าน+เขียนเกิดใน compute wake เดียวกัน แล้ว compute หลับยาวระหว่างรอบ

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), Drizzle ORM, `@neondatabase/serverless`, `unstable_cache` + `revalidateTag` (Vercel Data Cache), TypeScript

## Global Constraints

- **Verification model (อ่านก่อนเริ่ม):** repo นี้ **ไม่มี unit test framework** (ไม่มี vitest/jest, ไม่มี `test` script) — verify ตาม pattern เดิมของโปรเจกต์เท่านั้น: typecheck ผ่าน `pnpm build`/`tsc`, e2e ผ่าน `web/scripts/test-flow.sh` (curl กับ server ที่รันอยู่), และ **production observation บน Neon usage**. การเปลี่ยนแปลงหลัก (heartbeat fold, delete-on-success) ขึ้นกับ Next.js runtime + Neon จึง **ไม่สามารถ unit-test ได้** — อย่าพยายามเพิ่ม test framework ใหม่ (ขัด YAGNI + pattern เดิม)
- **success criterion ที่แท้จริงวัดได้หลัง deploy เท่านั้น:** compute-hours บน Neon console ต้องลงต่ำกว่า 191.9 hr/mo และ `last_seen` ต้องอัปเดตตาม cadence (ดูได้จาก dashboard online pill) — ไม่มี test ใดพิสูจน์ duty-cycle ได้ก่อน deploy
- ทุก mutation ของ `printers`/`print_jobs` **ต้องเรียก** `invalidatePrinters()` หรือ `invalidatePrinterJobs()` จาก `@/lib/cache/printer` มิฉะนั้น poll เห็นค่า stale ถึง TTL
- retention/expiry **ห้ามลบ row ที่ status = `pending`** — printer ที่ offline หลายวันต้องกู้คิวได้
- stuck-job self-heal inline ใน GET handler (`printing` > 10 นาที → `failed`) **คงไว้เหมือนเดิม** ห้ามแตะ
- ค่า timing ทั้งหมดต้องเป็น **named constant** (ปรับง่ายเมื่อ upgrade เป็น Neon Pro)
- `proxy.ts` config.matcher ต้องคง `api` ใน negative lookahead (middleware ห้าม run บน `/api/*` — กัน double-billing invocations)
- commit message ลงท้ายด้วย: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- working branch: `reduce-neon-compute` (มี design doc commit อยู่แล้ว) — อย่า commit ลง `main`

---

### Task 1: Heartbeat alignment (SPIKE — deploy & verify ก่อนทำ Task 2)

นี่คือ "production spike": deploy เฉพาะกลไก heartbeat แล้วยืนยันว่า compute ลดจริง + last_seen เดินตาม cadence **ก่อน** จะต่อ Task 2 บนฐานนี้ ถ้า compute ไม่ลด (เช่น staggered อยู่ดี) ให้หยุดและพิจารณา Tier 2 (KV/Redis) แทนที่จะสร้างของเพิ่ม

**Files:**
- Modify: `web/lib/constants.ts` (เพิ่ม 2 constants)
- Modify: `web/lib/cache/printer.ts` (แทน `fetchHasPendingJob`/`hasPendingJobCached` ด้วย `getPendingState`)
- Modify: `web/lib/cache/last-seen.ts` (เปลี่ยนจาก time-debounce → gen-gated `recordHeartbeat`)
- Modify: `web/lib/format.ts` (`isOnline` ใช้ constant ใหม่)
- Modify: `web/app/api/cloudprnt/route.ts` (POST handler wiring; **ไม่แตะ** GET self-heal และ ackJob)

**Interfaces:**
- Produces:
  - `lib/constants.ts`: `export const HEARTBEAT_SEC = 1800` (number, วินาที); `export const ONLINE_THRESHOLD_SEC = 2100` (number, วินาที)
  - `lib/cache/printer.ts`: `export type PendingState = { pending: boolean; gen: number }`; `export function getPendingState(printerId: string): Promise<PendingState>` — `invalidatePrinters()` / `invalidatePrinterJobs()` / `getPrinterByMacCached()` **คงเดิม ไม่เปลี่ยน signature**
  - `lib/cache/last-seen.ts`: `export function recordHeartbeat(printerId: string, statusCode: string | null, gen: number): Promise<void>` (เขียน `last_seen`/`last_status_code` เฉพาะเมื่อ gen ของ printer นี้ต่างจากที่ instance เคยเขียน)
- Consumes: ไม่มี (task แรก)

- [ ] **Step 1: เพิ่ม timing constants**

ใน `web/lib/constants.ts` ต่อท้ายไฟล์ (หลัง `API_KEY_PLACEHOLDER`):

```ts
// Neon compute heartbeat: idle Postgres touches (pending-state read +
// last_seen write) align to this single cadence so the compute can
// auto-suspend (Neon Free floor = 5 min). See
// docs/superpowers/specs/2026-06-18-reduce-neon-compute-design.md
export const HEARTBEAT_SEC = 1800; // 30 min

// Online-pill threshold — MUST exceed HEARTBEAT_SEC, otherwise a printer
// flickers offline between heartbeats when last_seen wasn't refreshed yet.
export const ONLINE_THRESHOLD_SEC = 2100; // 35 min
```

- [ ] **Step 2: แทน hasPendingJob cache ด้วย getPendingState**

ใน `web/lib/cache/printer.ts`:

1. เพิ่ม import constant ที่บนไฟล์:

```ts
import { HEARTBEAT_SEC } from '@/lib/constants';
```

2. ลบทั้งบล็อก `fetchHasPendingJob` (บรรทัด ~42-59) และ `hasPendingJobCached` (บรรทัด ~61-63) ออก แล้วแทนด้วย:

```ts
export type PendingState = { pending: boolean; gen: number };

// Single idle Postgres touch per heartbeat. Returns whether a job is waiting
// PLUS a generation stamp that flips on every (re)compute. The poll handler
// uses `gen` to decide when to write last_seen, so the read and the write
// land in the SAME compute wake. enqueue/claim/ack call invalidatePrinterJobs
// ({ expire: 0 }) so a real job busts this immediately — the long revalidate
// is only a missed-invalidation safety net (job delayed at most HEARTBEAT_SEC
// in that rare case).
const fetchPendingState = unstable_cache(
  async (printerId: string): Promise<PendingState> => {
    const job = await db.query.printJobs.findFirst({
      where: and(
        eq(printJobs.printerId, printerId),
        inArray(printJobs.status, ['pending', 'printing']),
      ),
      orderBy: asc(printJobs.createdAt),
      columns: { id: true },
    });
    return { pending: !!job, gen: Date.now() };
  },
  ['pending-state'],
  { tags: [PRINT_JOBS_TAG], revalidate: HEARTBEAT_SEC },
);

export function getPendingState(printerId: string) {
  return fetchPendingState(printerId);
}
```

(imports `and, asc, eq, inArray`, `db`, `printJobs`, `PRINT_JOBS_TAG` มีอยู่แล้วในไฟล์ — ตรวจว่ายังถูกใช้ ไม่ต้องลบ)

- [ ] **Step 3: เปลี่ยน last-seen เป็น gen-gated heartbeat write**

แทนเนื้อทั้งไฟล์ `web/lib/cache/last-seen.ts` ด้วย:

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';

// Per warm-instance: the heartbeat generation we last wrote for each printer.
// getPendingState() returns a `gen` that flips once per HEARTBEAT_SEC (cadence
// is global because the Data Cache entry is shared across instances). When an
// instance sees a new gen, it writes last_seen ONCE — synchronously in the
// poll handler (NOT inside unstable_cache, whose background revalidation may
// drop the write) — so the write rides the same compute wake as the read.
const lastGen = new Map<string, number>();

export async function recordHeartbeat(
  printerId: string,
  statusCode: string | null,
  gen: number,
): Promise<void> {
  if (lastGen.get(printerId) === gen) return;

  await db
    .update(printers)
    .set({ lastSeenAt: new Date(), lastStatusCode: statusCode })
    .where(eq(printers.id, printerId));

  // Mark only AFTER the write succeeds — a thrown UPDATE retries next poll
  // instead of silently skipping this heartbeat.
  lastGen.set(printerId, gen);
}
```

- [ ] **Step 4: wire POST handler ให้ใช้ getPendingState + recordHeartbeat**

ใน `web/app/api/cloudprnt/route.ts`:

1. แก้ import 2 บรรทัดบนไฟล์:

```ts
import {
  getPrinterByMacCached,
  getPendingState,
  invalidatePrinterJobs,
} from '@/lib/cache/printer';
import { recordHeartbeat } from '@/lib/cache/last-seen';
```

2. ในฟังก์ชัน `POST` แทนบล็อกเดิม (ตั้งแต่ `// Debounced — at most one UPDATE...` ถึงก่อนบรรทัด `// Cache says there's a job`) ด้วย:

```ts
  // Single heartbeat: pending read (cached, ~1×/HEARTBEAT) + aligned
  // last_seen write in the same compute wake.
  const { pending, gen } = await getPendingState(printer.id);
  await recordHeartbeat(
    printer.id,
    body.statusCode ? decodeURIComponent(String(body.statusCode)) : null,
    gen,
  );

  // Usually false → skip Postgres entirely, compute stays asleep.
  if (!pending) {
    return Response.json({ jobReady: false });
  }
```

(ส่วนหลังจากนี้ — `db.query.printJobs.findFirst(...)` เพื่อ confirm + คืน `jobToken` — **คงเดิมทั้งหมด** เพราะ `pending` แทน `hasPendingJobCached` ตรงๆ)

- [ ] **Step 5: ปรับ isOnline ให้ใช้ threshold ใหม่**

ใน `web/lib/format.ts`:

```ts
import { ONLINE_THRESHOLD_SEC } from '@/lib/constants';
```

แทน comment + ฟังก์ชัน `isOnline` (บรรทัด ~25-33) ด้วย:

```ts
// 35-min threshold: last_seen is refreshed once per heartbeat (~30 min, see
// lib/cache/last-seen.ts + lib/constants.ts) so a tighter window would
// flicker offline between heartbeats.
export function isOnline(lastSeenAt: Date | string | null): boolean {
  if (!lastSeenAt) return false;
  const date =
    typeof lastSeenAt === 'string' ? new Date(lastSeenAt) : lastSeenAt;
  const seconds = (Date.now() - date.getTime()) / 1000;
  return seconds < ONLINE_THRESHOLD_SEC;
}
```

- [ ] **Step 6: typecheck**

Run (จาก `web/`): `pnpm build`
Expected: build สำเร็จ ไม่มี TS error ไม่มี "hasPendingJobCached/maybeUpdateLastSeen is not exported" (ยืนยันว่าไม่มี caller ค้าง)

- [ ] **Step 7: e2e flow ยังทำงาน (local)**

เริ่ม dev server (`pnpm dev` ใน terminal แยก) แล้ว run: `bash scripts/test-flow.sh`
Expected: ทุกขั้น (1–5) สำเร็จ — submit job → poll คืน `jobReady:true` + `jobToken` → GET คืน StarPRNT bytes → DELETE คืน `HTTP 204` พฤติกรรมคิวไม่เปลี่ยนจากเดิม

- [ ] **Step 8: commit**

```bash
git add web/lib/constants.ts web/lib/cache/printer.ts web/lib/cache/last-seen.ts web/lib/format.ts web/app/api/cloudprnt/route.ts
git commit -m "$(cat <<'EOF'
Align idle Postgres touches into one heartbeat (Neon compute)

Replace the 5-min hasPendingJob TTL (which poked Neon right at the 5-min
auto-suspend boundary) and the per-instance last_seen debounce with a
single heartbeat: getPendingState() returns {pending, gen}; the poll
handler writes last_seen synchronously only when gen flips, so read+write
share one compute wake and the compute can sleep between heartbeats.
Online threshold 12->35 min to match. Verify compute drop on Neon usage.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: deploy spike + production verification (BLOCKING ก่อน Task 2)**

Deploy branch ไป preview/prod ของ rc2c (ดู memory: project-customer-migration / reference-customer-vercel) แล้วสังเกต **2–3 วัน**:
- Neon console → Usage: compute-hours rate ต้องลดลงชัดเจน (เป้า trajectory < 191.9 hr/mo)
- dashboard online pill: printer ที่ poll อยู่ต้องโชว์ online (พิสูจน์ว่า `last_seen` ยังถูกเขียนตาม cadence ไม่ถูก background-drop)
- ถ้า compute **ไม่** ลด หรือ pill flap offline → หยุด รายงานผล แล้วทบทวน Tier 2 (KV/Redis) แทนการทำ Task 2

---

### Task 2: Delete-on-success (ตัดประวัติงานพิมพ์สำเร็จ — storage hygiene)

ทำหลัง Task 1 ผ่าน verification แล้วเท่านั้น

**Files:**
- Modify: `web/app/api/cloudprnt/route.ts` (`ackJob` — success → DELETE)
- Modify: `web/app/(admin)/jobs/[id]/actions.ts` (`markJobDone` — DELETE + redirect)
- Modify: `web/app/api/cron/expire-stuck/route.ts` (retention → `failed` เท่านั้น)
- Modify: `web/app/(admin)/page.tsx` (heading ตาราง jobs)

**Interfaces:**
- Consumes: `invalidatePrinterJobs()` จาก `@/lib/cache/printer` (เดิม)
- Produces: ไม่มี export ใหม่ (เปลี่ยนพฤติกรรมภายใน)
- **Invariant ที่ task นี้ต้องรักษา:** หลังเปลี่ยนแล้ว **ไม่มี row ใดเป็น status `done` อีก** ทั้งจาก printer path (ackJob) และ manual path (markJobDone) → retention cron จึงกวาดเฉพาะ `failed` ได้อย่างสอดคล้อง

- [ ] **Step 1: ackJob ลบ row เมื่อสำเร็จ แทน UPDATE done**

ใน `web/app/api/cloudprnt/route.ts` แทนบล็อก `db.update(printJobs).set({ status: success ? 'done' : 'failed', ... })` ภายใน `ackJob` ด้วย:

```ts
  if (success) {
    // delete-on-success: ไม่เก็บประวัติงานสำเร็จ (ลด Neon storage)
    await db
      .delete(printJobs)
      .where(
        and(
          eq(printJobs.printerId, printer.id),
          eq(printJobs.status, 'printing'),
        ),
      );
  } else {
    await db
      .update(printJobs)
      .set({
        status: 'failed',
        errorMessage: `printer code: ${code ?? 'unknown'}`,
      })
      .where(
        and(
          eq(printJobs.printerId, printer.id),
          eq(printJobs.status, 'printing'),
        ),
      );
  }

  invalidatePrinterJobs();
  return new Response(null, { status: 204 });
```

(`and`, `eq`, `printJobs`, `db` import อยู่แล้ว — `db.delete` เป็น API ของ drizzle ที่ใช้ได้ทันที)

- [ ] **Step 2: markJobDone ลบ row + redirect กลับ dashboard**

แทนฟังก์ชัน `markJobDone` ใน `web/app/(admin)/jobs/[id]/actions.ts` ด้วย:

```ts
export async function markJobDone(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // delete-on-success ใช้กับ manual path ด้วย เพื่อไม่ให้เกิด row 'done' ค้าง
  // (retention cron กวาดเฉพาะ 'failed') — ปุ่มนี้คือ "เคลียร์งานนี้ออกจากคิว"
  await db.delete(printJobs).where(eq(printJobs.id, id));

  invalidatePrinterJobs();
  revalidatePath('/');
  redirect('/');
}
```

แก้ import ที่บนไฟล์ ให้มี `redirect`:

```ts
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
```

(`retryJob` คงเดิม — ตั้งกลับ `pending`)

- [ ] **Step 3: retention cron กวาดเฉพาะ failed**

ใน `web/app/api/cron/expire-stuck/route.ts`:

แก้ comment เหนือ query เป็น:

```ts
  // Retention-only: ไม่มี row 'done' อีกแล้ว (delete-on-success) → กวาดเฉพาะ
  // 'failed' เก่า. ห้ามแตะ 'pending' — printer offline 15+ วันต้องกู้คิวได้.
```

และเปลี่ยน `where`:

```ts
  const deleted = await db
    .delete(printJobs)
    .where(
      and(
        eq(printJobs.status, 'failed'),
        lt(printJobs.createdAt, retentionCutoff),
      ),
    )
    .returning({ id: printJobs.id });
```

แก้ import: เอา `inArray` ออก เพิ่ม `eq` → `import { and, eq, lt } from 'drizzle-orm';`

- [ ] **Step 4: ปรับ heading ตาราง jobs บน dashboard**

ใน `web/app/(admin)/page.tsx` เปลี่ยนข้อความ heading จาก:

```tsx
          Recent Jobs (last 50)
```

เป็น:

```tsx
          Active & Failed Jobs (last 50)
```

(ไม่ต้องแก้ query — `done` rows หายไปเอง เหลือ `pending`/`printing`/`failed`; งานที่พิมพ์เสร็จจะไม่ขึ้นในตารางอีก ซึ่งเป็นพฤติกรรมที่ต้องการ)

- [ ] **Step 5: typecheck**

Run (จาก `web/`): `pnpm build`
Expected: build สำเร็จ ไม่มี TS error (ยืนยัน `inArray` ที่เอาออกไม่มีที่ใช้ค้างใน cron, `redirect` import ถูกต้อง)

- [ ] **Step 6: e2e — งานสำเร็จถูกลบจริง**

dev server รันอยู่ แล้ว run: `bash scripts/test-flow.sh`
Expected: ขั้น 1–5 สำเร็จเหมือนเดิม จากนั้นยืนยันว่า row ถูกลบ — poll ซ้ำ 1 ครั้ง:
```bash
curl -s -X POST http://localhost:3000/api/cloudprnt -H "Content-Type: application/json" -d '{"printerMAC":"00:11:62:00:00:01","statusCode":"200%20OK"}'
```
Expected: `{"jobReady":false}` (งานเดียวที่ submit ถูกพิมพ์+ลบแล้ว ไม่มีงานค้าง) และเปิด dashboard `/` ตาราง "Active & Failed Jobs" ต้องไม่มีงานที่เพิ่งพิมพ์สำเร็จ

- [ ] **Step 7: commit**

```bash
git add web/app/api/cloudprnt/route.ts web/app/\(admin\)/jobs/\[id\]/actions.ts web/app/api/cron/expire-stuck/route.ts web/app/\(admin\)/page.tsx
git commit -m "$(cat <<'EOF'
Delete print jobs on success instead of keeping history

ackJob and markJobDone now DELETE the row (no 'done' rows ever exist), so
the retention cron sweeps only 'failed'. Dashboard shows active+failed
jobs. Trims Neon storage; pending is never deleted so offline printers
still recover their queue.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: deploy + verify storage trajectory**

Deploy แล้วยืนยันบน Neon console: storage ทรงตัว/ลด (row done ไม่สะสม) และ dashboard ยังแสดง failed jobs ให้ retry ได้

---

## Notes / นอกขอบเขต

- **Tier 2 (fallback):** ถ้า Task 1 verification พบว่า compute ยังเกิน → ย้าย job queue + last_seen ไป Upstash Redis / Vercel KV ให้ Neon เหลือแค่ printer config (อ่าน 1×/ชม.) — เขียนเป็น spec/plan แยกเมื่อถึงจุดนั้น
- **Vercel invocations (คนละ limit):** Printer A poll ทุก ~5s ควรตั้งเป็น 60s บนหน้า CloudPRNT web UI ของเครื่อง — เปลี่ยนจากโค้ดไม่ได้ ไม่อยู่ในแผนนี้
- **UX ที่ยอมรับแล้ว:** online pill หยาบลง ~35 นาที; งานที่พิมพ์สำเร็จเปิดหน้า `/jobs/[id]` จะ 404 (row ถูกลบ)
```
