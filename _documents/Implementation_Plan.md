# Implementation Plan
## Cloud Receipt Printing Middleware (Next.js + Vercel)

| รายการ | ข้อมูล |
|---|---|
| อ้างอิง SoW | `Scope_of_Work_NextJS_Vercel.md` |
| Target | Production-ready ภายใน 7 วันทำการ |
| Stack | Next.js 16 (App Router) + Vercel + Postgres (Neon) + Drizzle + Auth.js |
| Repo | `widelynext/starprinter-hub` (Git, GitHub) |

---

## 0. Pre-Flight Checklist (ก่อนเริ่ม Day 1)

ทำเมื่อ kick-off / Phase 1 ตอนเช้าวันแรก ทุกข้อต้อง ✅ ก่อนเริ่ม dev

### 0.1 Decisions ที่ต้องเคาะกับ stakeholder

- [ ] **3 Templates** — ลูกค้าส่ง spec/ตัวอย่างใบเสร็จ + payload schema ครบทั้ง 3 แบบ
- [ ] **Routing strategy หลัก** — `JobID Prefix` หรือ `Branch Code` (เลือกอันใดอันหนึ่งเป็น default, อีกอันเป็น override)
- [ ] **Zoho Webhook payload** — ลูกค้าส่งตัวอย่าง JSON จริงที่ Zoho จะยิงมา
- [ ] **Domain** — ใช้ subdomain ของลูกค้าเอง หรือของ Widely Next (`xxx.widelynext.com`)
- [ ] **Admin user** — email ของ admin คนแรก (ตั้งรหัสครั้งแรกผ่าน CLI)
- [ ] **เลือก Option** — A (เต็มสโคป) หรือ B (MVP) — เพื่อ lock scope ก่อนเริ่ม

### 0.2 Accounts / Access ที่ต้องเตรียม

- [ ] GitHub repo (private) + invite team
- [ ] Vercel team + project + invite team
- [ ] Vercel Postgres (สร้างตอน setup project)
- [ ] Star Printer 1 เครื่อง (สำหรับ test) — ทราบ MAC + IP
- [ ] Zoho Creator sandbox/test account (ตัวอย่างยิง webhook)

### 0.3 Conventions ที่ใช้ทั้งโปรเจกต์

| เรื่อง | กำหนด |
|---|---|
| Timezone | `Asia/Bangkok` (เก็บ UTC ใน DB, แปลงตอน render UI) |
| Currency | THB |
| Charset | UTF-8 (รองรับภาษาไทยทุก field) |
| Code style | ESLint + Prettier (default Next.js) + TypeScript strict |
| Commit | Conventional Commits (`feat:`, `fix:`, `chore:` ...) |
| Branch | `main` = production, feature branches = `feat/<topic>` |

---

## 1. Repository Structure

```
starprinter-hub/
├── app/
│   ├── (admin)/                  # admin UI (auth-gated layout)
│   │   ├── dashboard/page.tsx
│   │   ├── printers/page.tsx
│   │   ├── printers/[id]/page.tsx
│   │   ├── jobs/page.tsx
│   │   ├── jobs/[id]/page.tsx
│   │   ├── templates/page.tsx
│   │   ├── settings/page.tsx
│   │   └── layout.tsx
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── zoho/jobs/route.ts          # POST — Zoho webhook receiver
│   │   ├── cloudprnt/[printerId]/route.ts   # POST/GET/DELETE — Star printer
│   │   └── cron/
│   │       ├── retry-stuck-jobs/route.ts
│   │       └── cleanup-events/route.ts
│   └── layout.tsx
├── lib/
│   ├── db/
│   │   ├── index.ts             # drizzle client
│   │   ├── schema.ts            # tables
│   │   └── queries/             # query helpers
│   ├── auth/
│   │   └── config.ts            # auth.js options
│   ├── routing/
│   │   └── select-printer.ts    # JobID Prefix / Branch Code logic
│   ├── queue/
│   │   ├── enqueue.ts
│   │   ├── claim.ts             # FOR UPDATE SKIP LOCKED
│   │   └── ack.ts
│   ├── templates/
│   │   ├── index.ts             # template registry
│   │   ├── receipt.ts
│   │   ├── job-close.ts
│   │   └── delivery.ts
│   ├── star/
│   │   └── starprnt.ts          # raw command builders (optional)
│   └── validation/
│       └── schemas.ts           # Zod schemas
├── components/
│   └── ui/                      # shadcn/ui generated
├── drizzle/                     # generated migrations
├── public/
├── scripts/
│   └── create-admin.ts          # CLI to seed first admin
├── .env.local                   # local dev secrets
├── drizzle.config.ts
├── vercel.json                  # cron config
├── next.config.ts
├── tsconfig.json
└── package.json
```

---

## 2. Phase 1: Foundation (Day 1)

### 2.1 Repo Bootstrap

```bash
pnpm create next-app starprinter-hub --typescript --tailwind --app --no-src-dir
cd starprinter-hub
pnpm add drizzle-orm @neondatabase/serverless
pnpm add -D drizzle-kit
pnpm add next-auth@beta @auth/drizzle-adapter
pnpm add zod bcryptjs
pnpm add -D @types/bcryptjs
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card input label table badge dropdown-menu dialog form sonner
```

### 2.2 Vercel + Postgres

```bash
pnpm dlx vercel link              # link repo to Vercel project
pnpm dlx vercel env pull .env.local   # pull env vars locally
```

ใน Vercel Dashboard → Storage → Create Database → Postgres (Neon) → connect to project

จะได้ env vars อัตโนมัติ: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, ฯลฯ

### 2.3 Drizzle Setup

`drizzle.config.ts`
```typescript
import type { Config } from 'drizzle-kit';
export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.POSTGRES_URL! },
} satisfies Config;
```

`lib/db/index.ts`
```typescript
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.POSTGRES_URL!);
export const db = drizzle(sql, { schema });
```

> **หมายเหตุ Edge runtime:** ใช้ `neon-http` driver — รองรับทั้ง Node และ Edge

### 2.4 Database Schema

`lib/db/schema.ts`
```typescript
import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum, boolean } from 'drizzle-orm/pg-core';

export const jobStatus = pgEnum('job_status', [
  'pending', 'printing', 'done', 'failed', 'expired'
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiClients = pgTable('api_clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const printers = pgTable('printers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  branchCode: text('branch_code'),
  jobPrefix: text('job_prefix'),
  macAddress: text('mac_address').unique(),
  apiKeyHash: text('api_key_hash').notNull(),
  pollIntervalSec: integer('poll_interval_sec').notNull().default(10),
  lastSeenAt: timestamp('last_seen_at'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const printJobs = pgTable('print_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  printerId: uuid('printer_id').notNull().references(() => printers.id),
  sourceJobId: text('source_job_id').notNull().unique(),  // จาก Zoho — กัน duplicate
  templateCode: text('template_code').notNull(),
  payload: jsonb('payload').notNull(),
  status: jobStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  claimedAt: timestamp('claimed_at'),
  printedAt: timestamp('printed_at'),
});

export const jobEvents = pgTable('job_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').notNull().references(() => printJobs.id),
  event: text('event').notNull(),  // received, routed, claimed, printed, failed, retry, expired
  message: text('message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

Index แนะนำ (ใส่ใน migration เพิ่มเติม)
- `print_jobs(printer_id, status, created_at)` — สำหรับ queue lookup
- `print_jobs(source_job_id)` — unique อยู่แล้ว แต่ ensure index
- `job_events(job_id, created_at desc)` — สำหรับ timeline

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit push
```

### 2.5 Auth.js Setup

`lib/auth/config.ts` — Credentials provider, bcrypt verify, JWT session

`scripts/create-admin.ts` — CLI seed admin user คนแรก
```bash
pnpm tsx scripts/create-admin.ts admin@example.com 'StrongPass123'
```

### 2.6 Environment Variables

| ENV | ใช้ที่ไหน | Production / Preview / Dev |
|---|---|---|
| `POSTGRES_URL` | DB | auto จาก Vercel |
| `POSTGRES_URL_NON_POOLING` | migration | auto จาก Vercel |
| `AUTH_SECRET` | Auth.js | สุ่ม 32 ไบต์ ต่อ env |
| `ZOHO_API_KEY` | webhook auth | สุ่ม 32 ไบต์ ใส่ Production |
| `CRON_SECRET` | ป้องกัน cron endpoint | สุ่ม 32 ไบต์ |
| `NEXTAUTH_URL` | Auth.js callback | URL จริงของ env นั้น |

Sync ผ่าน `vercel env pull` เป็นระยะ

**Day 1 Done When:**
- `pnpm dev` รันได้, DB connect ได้, login ได้ด้วย admin user, deploy preview ขึ้น Vercel ได้

---

## 3. Phase 2: Core API (Day 2–4)

### 3.1 Zoho Webhook Receiver — `app/api/zoho/jobs/route.ts`

**Day 2 morning**

```typescript
export const runtime = 'nodejs';

const RequestSchema = z.object({
  jobId: z.string().min(1),         // unique ID จาก Zoho — สำหรับ idempotency
  branchCode: z.string().optional(),
  printerId: z.string().uuid().optional(),  // override
  templateCode: z.enum(['receipt', 'job-close', 'delivery']),
  payload: z.record(z.unknown()),
});

export async function POST(req: Request) {
  // 1) verify x-api-key header → match apiClients
  // 2) parse + validate body (Zod)
  // 3) idempotency: SELECT FROM print_jobs WHERE source_job_id = ?
  //    ถ้ามีแล้ว → 200 { jobId, status: 'duplicate' }
  // 4) routing: select-printer.ts (printerId | branchCode | jobPrefix from jobId)
  // 5) INSERT print_jobs + job_events('received')
  // 6) return 201 { jobId, queuePosition, printerId }
}
```

**Acceptance:**
- ยิง POST ไม่มี header → 401
- ยิงซ้ำด้วย `jobId` เดิม → ไม่ insert ซ้ำ, return เดิม
- ตัว routing เลือก printer ตาม branchCode / jobPrefix ได้ถูก

### 3.2 CloudPRNT Endpoint — `app/api/cloudprnt/[printerId]/route.ts`

**Day 2 afternoon — Day 3**

ใช้ Edge runtime สำหรับลด invocation cost

```typescript
export const runtime = 'edge';

// POST: printer poll (status check)
export async function POST(req, { params }) {
  // 1) verify printer api key + MAC address
  // 2) update printers.last_seen_at = now()
  // 3) SELECT next pending job (no claim yet, just peek)
  // 4) return { jobReady, mediaTypes: ['text/plain'], jobToken: <jobId> }
}

// GET: printer fetches content
export async function GET(req, { params }) {
  // 1) verify auth
  // 2) atomic claim:
  //    UPDATE print_jobs SET status='printing', claimed_at=NOW(), attempts=attempts+1
  //    WHERE id = (SELECT id FROM print_jobs
  //                WHERE printer_id=? AND status='pending'
  //                ORDER BY created_at LIMIT 1
  //                FOR UPDATE SKIP LOCKED)
  //    RETURNING *
  // 3) render template(payload) → string
  // 4) job_events('claimed')
  // 5) return text/plain
}

// DELETE: printer ack
export async function DELETE(req, { params }) {
  // 1) verify auth + jobToken matches a 'printing' job
  // 2) UPDATE print_jobs SET status='done', printed_at=NOW()
  // 3) job_events('printed')
  // 4) return 204
}
```

**ประเด็นสำคัญ — atomic claim:**
SQL `FOR UPDATE SKIP LOCKED` เป็นวิธี standard ของ Postgres ทำ queue ถูกต้องแม้มี printer หลายเครื่อง poll พร้อมกัน แต่ละแถวจะ claim ได้แค่ printer เดียว

**Acceptance:**
- จำลองด้วย 2 process poll พร้อมกัน → ไม่มี job ถูก claim ซ้ำ
- printer offline > 60s → `last_seen_at` แสดงสถานะถูก
- ครบ flow POST → GET → DELETE ใน Star printer real device

### 3.3 Routing Engine — `lib/routing/select-printer.ts`

**Day 3 afternoon**

```typescript
export async function selectPrinter(input: {
  printerId?: string;
  branchCode?: string;
  jobId: string;
}): Promise<{ id: string } | null> {
  // 1) ถ้ามี printerId ใช้เลย (override)
  // 2) ถ้ามี branchCode → SELECT printers WHERE branch_code = ? AND is_active
  // 3) ลอง prefix matching: จาก jobId เช่น 'BKK-0001' → prefix='BKK-'
  //    SELECT printers WHERE job_prefix = ? AND is_active
  // 4) ถ้ายังไม่ได้ → fallback printer (มี flag is_default) หรือ throw
}
```

**Acceptance:**
- unit test 8+ cases (มี printerId / มี branchCode / prefix match / ไม่ match → fallback / printer offline → skip ไป default)

### 3.4 Templates — `lib/templates/`

**Day 4 morning**

```typescript
type Template = (payload: unknown) => string;

export const templates: Record<string, Template> = {
  'receipt': renderReceipt,
  'job-close': renderJobClose,
  'delivery': renderDelivery,
};
```

แต่ละ template
- รับ payload → validate ด้วย Zod (template-specific schema)
- return plain text (Star printer ตีความ line-by-line)
- รองรับภาษาไทย (UTF-8)
- มี width = 32 chars (default Star receipt printer)
- ใส่ `\n\n\n` ท้ายเพื่อ feed กระดาษก่อนตัด

**Acceptance:**
- snapshot test แต่ละ template ด้วย sample payload
- preview ได้จาก `/templates` ใน Admin UI

### 3.5 Cron Jobs — `vercel.json`

**Day 4 afternoon**

```json
{
  "crons": [
    { "path": "/api/cron/retry-stuck-jobs", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/cleanup-events",    "schedule": "0 3 * * *" }
  ]
}
```

`/api/cron/retry-stuck-jobs` — งานที่ `status='printing'` แต่ `claimed_at` > 60 วินาทีที่แล้ว → คืนเป็น `pending` (พร้อม `attempts++`) ถ้า attempts ≥ 3 → `failed`

`/api/cron/cleanup-events` — ลบ `job_events` เก่ากว่า 90 วัน

ทั้ง 2 endpoint ตรวจ `Authorization: Bearer ${CRON_SECRET}` (Vercel cron แนบให้อัตโนมัติ)

**Day 4 Done When:**
- ยิง E2E ผ่าน sim ได้: POST `/api/zoho/jobs` → poll `/api/cloudprnt/...` ได้ content กลับมา → DELETE → status `done`
- Race condition test ผ่าน
- Cron retry ทำงาน

---

## 4. Phase 3: Admin UI + Logging (Day 5–6)

### 4.1 Layout + Auth Gate (Day 5 morning)

`app/(admin)/layout.tsx`
- ตรวจ session ผ่าน Auth.js, ไม่มี → redirect `/login`
- Sidebar nav: Dashboard, Printers, Jobs, Templates, Settings
- Sonner toast provider

### 4.2 Dashboard `/dashboard` (Day 5 morning)

Cards แสดง
- งานวันนี้: total / done / failed / pending
- Printer status: list 7 เครื่อง พร้อมจุด online/offline (ดูจาก `last_seen_at` < 2× pollInterval = online)
- 10 jobs ล่าสุด

ใช้ Server Components + revalidate ทุก 10 วินาที (`export const revalidate = 10`) — แทน real-time polling ใน UI

### 4.3 Printers CRUD `/printers` (Day 5 afternoon)

- Table list (shadcn `<Table>`) — name, branch, prefix, MAC, last seen, status
- Dialog form: เพิ่ม/แก้ไข — Server Action submit
- ตอนสร้าง printer → generate API key (โชว์ครั้งเดียวพร้อม copy button) + เก็บ hash ใน DB
- จำกัดไม่เกิน 7 (validate ที่ server)

### 4.4 Jobs `/jobs` + `/jobs/[id]` (Day 6 morning)

- `/jobs` — table + filter chips (status, printer, date range), pagination, **Export CSV** button
- `/jobs/[id]` — แสดง:
  - meta (printer, template, source job ID, status, timestamps)
  - rendered content preview (gray monospace box)
  - raw payload (JSON pretty)
  - timeline ของ `job_events`
  - ปุ่ม "Retry" (ถ้า failed) — set status เป็น pending

### 4.5 Templates `/templates` + Settings `/settings` (Day 6 afternoon)

`/templates` — แสดง 3 templates พร้อม sample payload + preview output

`/settings`:
- API Keys: list `apiClients` + ปุ่ม rotate (สร้างใหม่, mark old as revoked)
- Polling default: ค่ามาตรฐานสำหรับ printer ใหม่
- Audit log (Option A): ใครเข้าระบบเมื่อไร

**Day 6 Done When:**
- ทุกหน้าเปิดได้, CRUD ได้, log ครบ
- Lighthouse mobile score > 80

---

## 5. Phase 4: Test & Handover (Day 7)

### 5.1 E2E Test Plan

ทดสอบกับ Star Printer + Zoho Creator จริง

| # | Scenario | Expected |
|---|---|---|
| 1 | Zoho ส่ง webhook valid → printer พิมพ์ออก | ใบเสร็จออกถูกต้อง, status `done` |
| 2 | Zoho ส่ง jobId ซ้ำ | duplicate response, ไม่พิมพ์ซ้ำ |
| 3 | ยิง webhook แต่ไม่มี printer ตรง branchCode | failed + error message ใน /jobs/[id] |
| 4 | Printer ปิดเครื่อง → ส่งงาน → เปิดเครื่อง | งานออกหลังเปิดภายใน 2× pollInterval |
| 5 | ปลั๊กกระดาษหมด (ถ้าจำลองได้) | printer status reflect, จะลองใหม่อัตโนมัติ |
| 6 | 2 printers พร้อมกัน + 5 งาน | กระจายตาม routing rule, ไม่ซ้ำ |
| 7 | สั่ง retry job ที่ failed | ออกได้สำเร็จ |

### 5.2 Production Deploy Checklist

- [ ] Domain เชื่อม Vercel (TLS เขียวแล้ว)
- [ ] Environment variables Production ครบ + ค่าจริง (ไม่ใช่ test secret)
- [ ] DB migration push ขึ้น production (`drizzle-kit push --config production`)
- [ ] Admin user คนแรกสร้างแล้ว
- [ ] Star Printers ตั้งค่า CloudPRNT URL ชี้ไป production domain
- [ ] Zoho Creator webhook ชี้ไป production domain + key ตรง
- [ ] Vercel Cron ทำงานแล้ว (เห็น invocation log)
- [ ] Sentry / Error tracking (optional add-on)

### 5.3 Handover Documents

ส่งให้ลูกค้าใน Day 7

1. **README.md** ใน repo — quickstart, deploy, env vars
2. **Runbook.md** — วิธี:
   - rotate API key
   - เพิ่ม admin user
   - ดู production log
   - rollback deploy
   - ดึง CSV ของ jobs
3. **API.md** — endpoint spec สำหรับทีมที่ Zoho integrate
4. **Architecture.md** — แผนภาพ + caveat (เช่น invocation cost)

---

## 6. Testing Strategy

### 6.1 Unit Test (Vitest)

- `lib/routing/select-printer.test.ts` — ทุก branch
- `lib/templates/*.test.ts` — snapshot test
- `lib/queue/claim.test.ts` — race condition (จำลองด้วย Promise.all)

### 6.2 Integration Test (ระหว่าง Phase 2)

ใช้สคริปต์ `starprint.php` (มีอยู่แล้วใน `php-poc/`) ปรับเป็น Node script `scripts/sim-printer.ts` — poll endpoint ของ Next.js dev server เพื่อทดสอบ flow โดยไม่มีเครื่องจริง

### 6.3 E2E Test (Phase 4)

Manual test กับ Star Printer + Zoho จริง ตามตารางข้อ 5.1

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vercel invocation cost เกินคาด | Medium | $$ | ตั้ง polling = 10s default, monitor Vercel usage รายสัปดาห์, แจ้งลูกค้าก่อนเปลี่ยน plan |
| Edge runtime + DB driver ไม่ stable | Low | High | Fallback ใช้ `runtime = 'nodejs'` สำหรับ poll endpoint ถ้าจำเป็น |
| Star Printer firmware ไม่รองรับ DELETE | Medium | Medium | มี timeout-based reclaim (cron ทุก 5 นาที) เป็น safety net |
| Zoho payload เปลี่ยนรูป | Low | Medium | Zod validation จับได้ทันที + log เป็น `failed` พร้อม raw body ใน error |
| Race condition ใน queue claim | Medium ถ้าไม่ระวัง | High | `FOR UPDATE SKIP LOCKED` + integration test |
| Printer มี IP ซ้ำ / MAC ซ้ำ | Low | High | Unique constraint + validate ตอน create |
| ลูกค้าเปลี่ยน template spec กลางคัน | Medium | Medium | Lock spec ใน Phase 1, change ภายหลัง = change request |

---

## 8. Open Questions (ต้อง confirm กับลูกค้าก่อน Phase 2)

1. Zoho Creator ส่ง webhook สำเร็จแล้วต้องการ ack รูปแบบไหน? (`200 OK` ธรรมดา หรือ JSON พิเศษ)
2. ถ้า routing หางานไม่เจอ printer → fail หรือ fallback ไป default printer?
3. Templates รองรับ logo / QR code / barcode หรือไม่? (ถ้ามี ต้องใช้ StarPRNT raw command)
4. ต้องการเก็บประวัติเอกสารที่พิมพ์เป็น PDF ด้วยหรือไม่? (เพิ่ม Vercel Blob)
5. Multi-tenant ในอนาคต — ต้องการแยกข้อมูลหลายลูกค้า หรือ instance เดียว?
6. Admin มีกี่บัญชี / ต้องการ SSO หรือไม่?
7. ระบบต้องเชื่อม LINE Notify / Email alert หรือไม่ (Optional ใน SoW)?

---

## 9. Daily Stand-up Template

ใช้ตอน Phase 2–4 (รายงาน PM ตอนเย็นทุกวัน)

```
Day X — <Phase Y>
✅ Done today:    <เสร็จอะไร>
🚧 In progress:   <กำลังทำอะไร, % เสร็จ>
🔴 Blocked:       <ติดอะไร, ต้องการ input จากใคร>
📅 Tomorrow:      <จะทำอะไร>
```

---

## 10. Definition of Done (Project-level)

โปรเจกต์จะถือว่าส่งมอบสมบูรณ์เมื่อ ทุกข้อ ✅

- [ ] Production URL เปิดได้, HTTPS ใช้ได้, login ได้
- [ ] Star Printer ของลูกค้า (อย่างน้อย 1 เครื่อง) พิมพ์ใบเสร็จจาก Zoho ได้สำเร็จ end-to-end
- [ ] ทุก scenario ในตาราง 5.1 ผ่านครบ
- [ ] Admin ลูกค้าใช้ UI ได้ด้วยตัวเอง: เพิ่ม printer, ดู job, rotate key
- [ ] Source code อยู่ใน GitHub repo ที่ลูกค้ามี admin
- [ ] Vercel project transfer ให้ลูกค้า (หรือ shared access)
- [ ] เอกสารทั้ง 4 ไฟล์ใน Section 5.3 ส่งครบ
- [ ] ลูกค้า sign-off acceptance form
