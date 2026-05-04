# Implementation Plan — Simple Edition
## Restaurant Cloud Receipt Printing (Zoho → Star Printer)

> **บริบท:** ลูกค้าเปิดร้านอาหาร, ใช้ Zoho เป็นระบบ order, ต้องการให้ Zoho ยิง order ไปออก printer
> **Scale:** ≤ 10 เครื่องพิมพ์
> **Reliability tier:** Best-effort — ถ้าพิมพ์ไม่ออก พนักงานสั่งใหม่จาก Zoho, ไม่ต้อง retry/HA
> **Replaces:** `Implementation_Plan.md` (เวอร์ชันเต็มเก็บเป็น reference)

---

## 1. ตัดอะไรออกจากเวอร์ชันก่อน

| Feature | เวอร์ชันเต็ม | เวอร์ชันนี้ | เหตุผล |
|---|---|---|---|
| Multi-user admin | ✓ | ❌ | คนเดียวก็พอ — password เดียวใน env var |
| Auth.js | ✓ | ❌ | Cookie + middleware เช็ค password เอง |
| `job_events` audit table | ✓ | ❌ | สถานะใน `print_jobs` พอ |
| `api_clients` table | ✓ | ❌ | Zoho key เก็บใน env var |
| `users` table | ✓ | ❌ | เหตุผลเดียวกับ Auth.js |
| Atomic claim (FOR UPDATE SKIP LOCKED) | ✓ | ❌ | 1 printer/สาขา ไม่มี race |
| `clientAction` capability discovery | ✓ | ❌ | ใช้ `text/plain` ตายตัว, ไม่ต้องรู้ width |
| Retry policy + cron | ✓ | ลดเหลือ 1 cron | ค้างใน printing > 5 นาที → mark failed; ไม่ retry อัตโนมัติ |
| CSV export | ✓ | ❌ | ดูใน DB ผ่าน Drizzle Studio พอ |
| Templates UI preview | ✓ | ❌ | Render ดูที่ `/jobs/[id]` ก็เห็น |
| Settings page | ✓ | ❌ | แก้ใน env var / DB ตรง ๆ |
| Edge runtime | ✓ | ❌ | ใช้ Node runtime ทุก route — debug ง่ายกว่า |
| Templates 3 ตัวพร้อม | ✓ | เริ่ม 1 ตัว | เพิ่มเมื่อจำเป็น |

ที่ **คงไว้** : Next.js 16 + Vercel + Postgres + Drizzle + shadcn/ui

---

## 2. Final Scope (จริง ๆ)

### IN
- รับ Zoho webhook → enqueue งานพิมพ์
- Star Printer poll → ส่งใบเสร็จเป็น text กลับ
- Admin page: ดูสถานะ printer + งานพิมพ์ล่าสุด 50 งาน
- กดดู payload + กด re-print/mark-failed manual

### OUT
- Retry อัตโนมัติ (พิมพ์ไม่ออก = สั่งใหม่จาก Zoho)
- โลโก้ / รูป / barcode / QR (ใช้ text/plain ล้วน)
- Multi-tenant
- Real-time push (polling อย่างเดียว)
- MQTT
- Templates editor
- CSV / report

---

## 3. Architecture (1 page)

```
┌────────────┐  POST /api/zoho/orders            ┌─────────────────────┐
│  Zoho      │  Header: x-api-key                │  Vercel (Next.js)   │
│  Creator   │ ─────────────────────────────────►│  ┌───────────────┐  │
└────────────┘                                   │  │  print_jobs   │  │
                                                 │  │  printers     │  │
                                                 │  └───────┬───────┘  │
┌────────────┐  POST /api/cloudprnt              │          │          │
│ Star       │  body: { printerMAC, statusCode } │  ┌───────▼───────┐  │
│ Printer    │ ─────────────────────────────────►│  │ /api/cloudprnt│  │
│ x10 max    │ ◄──── { jobReady, mediaTypes }   ─┤  └───────────────┘  │
│            │                                   │                     │
│            │  GET ?mac=XX → text/plain         │  ┌───────────────┐  │
│            │  DELETE ?mac=XX&code=200          │  │  Admin UI     │  │
│            │                                   │  │  (3 pages)    │  │
└────────────┘                                   │  └───────────────┘  │
                                                 └─────────────────────┘
```

---

## 4. Database Schema (2 tables)

```typescript
// lib/db/schema.ts

export const printers = pgTable('printers', {
  id: uuid('id').defaultRandom().primaryKey(),
  macAddress: text('mac_address').notNull().unique(),  // primary identifier จาก CloudPRNT
  name: text('name').notNull(),
  branchCode: text('branch_code'),                      // สำหรับ routing
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at'),
  lastStatusCode: text('last_status_code'),             // "200 OK", "507 Cover Open" ฯลฯ
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const printJobs = pgTable('print_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  printerId: uuid('printer_id').notNull().references(() => printers.id),
  sourceJobId: text('source_job_id').notNull().unique(),  // จาก Zoho — กัน duplicate
  template: text('template').notNull().default('order'),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),    // pending | printing | done | failed
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  printedAt: timestamp('printed_at'),
});
```

Index แนะนำ: `print_jobs(printer_id, status, created_at)`

---

## 5. Endpoints (4 ตัวจบ)

### 5.1 `POST /api/zoho/orders` — รับจาก Zoho

```typescript
// app/api/zoho/orders/route.ts
export async function POST(req: Request) {
  if (req.headers.get('x-api-key') !== process.env.ZOHO_API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json();
  const parsed = z.object({
    orderId: z.string(),
    branchCode: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number(), price: z.number() })),
    total: z.number(),
    customerName: z.string().optional(),
    note: z.string().optional(),
  }).parse(body);

  // หา printer ตาม branchCode
  const printer = await db.query.printers.findFirst({
    where: and(eq(printers.branchCode, parsed.branchCode), eq(printers.isActive, true)),
  });
  if (!printer) return Response.json({ error: 'no printer for branch' }, { status: 400 });

  // idempotent enqueue
  await db.insert(printJobs).values({
    printerId: printer.id,
    sourceJobId: parsed.orderId,
    template: 'order',
    payload: parsed,
  }).onConflictDoNothing();

  return Response.json({ ok: true });
}
```

### 5.2 `POST /api/cloudprnt` — Printer poll

ตาม official manual: POST แค่ "ดู" (peek) ว่ามีงานหรือไม่ ไม่ต้องเปลี่ยน state งาน — ส่ง `jobToken` ให้ printer ผูกกับ job ที่จะดึง

```typescript
export async function POST(req: Request) {
  const body = await req.json();
  const mac = body.printerMAC?.toLowerCase();
  if (!mac) return Response.json({ jobReady: false });

  const printer = await db.query.printers.findFirst({ where: eq(printers.macAddress, mac) });
  if (!printer || !printer.isActive) return Response.json({ jobReady: false });

  // อัปเดต last_seen + status code (ทุก poll printer แนบ statusCode มาเสมอ)
  await db.update(printers)
    .set({ lastSeenAt: new Date(), lastStatusCode: decodeURIComponent(body.statusCode ?? '') })
    .where(eq(printers.id, printer.id));

  // หา job ที่ pending หรือ printing (printing = ยังค้างจาก GET ครั้งก่อนที่ printer ยังไม่ DELETE)
  const job = await db.query.printJobs.findFirst({
    where: and(
      eq(printJobs.printerId, printer.id),
      inArray(printJobs.status, ['pending', 'printing']),
    ),
    orderBy: asc(printJobs.createdAt),
  });

  return Response.json({
    jobReady: !!job,
    mediaTypes: job ? ['text/plain'] : undefined,
    jobToken: job?.id,        // ให้ printer ผูก GET/DELETE กับ job นี้
  });
}
```

### 5.3 `GET /api/cloudprnt?mac=XX` — Printer fetch content

GET ต้องเป็น **idempotent** — ยิงซ้ำต้องได้ content เดิม จนกว่าจะ DELETE ดังนั้น claim job (pending → printing) ใน GET ครั้งแรก แต่ครั้งถัดไปดึง job ที่ status='printing' กลับมาเลย

```typescript
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mac = url.searchParams.get('mac')?.toLowerCase();
  if (!mac) return new Response('mac required', { status: 400 });

  // Delete-via-GET (กรณีตั้ง deleteMethod: GET เผื่อ printer รุ่นเก่า)
  if (url.searchParams.has('delete')) {
    return handleDelete(mac, url.searchParams.get('code'));
  }

  const printer = await db.query.printers.findFirst({ where: eq(printers.macAddress, mac) });
  if (!printer) return new Response('not found', { status: 404 });

  // 1) ลอง fetch job ที่กำลัง printing อยู่ก่อน (idempotent — printer GET ซ้ำได้ content เดิม)
  let job = await db.query.printJobs.findFirst({
    where: and(eq(printJobs.printerId, printer.id), eq(printJobs.status, 'printing')),
    orderBy: asc(printJobs.createdAt),
  });

  // 2) ถ้ายังไม่มี printing → claim next pending (atomic LIMIT 1)
  if (!job) {
    const subquery = db.select({ id: printJobs.id })
      .from(printJobs)
      .where(and(eq(printJobs.printerId, printer.id), eq(printJobs.status, 'pending')))
      .orderBy(asc(printJobs.createdAt))
      .limit(1);

    [job] = await db.update(printJobs)
      .set({ status: 'printing' })
      .where(inArray(printJobs.id, subquery))
      .returning();
  }

  if (!job) return new Response('', { status: 200 });

  const text = renderTemplate(job.template, job.payload);
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
```

> **ทำไมต้อง idempotent:** ตาม manual ระบุ "GET should have no server side effects; simply re-sending the same GET should result in re-downloading the same job until the server state is changed by a POST or DELETE." — printer อาจ retry GET ถ้า network glitch กลางทาง

### 5.4 `DELETE /api/cloudprnt?mac=XX&code=200`

Printer ส่ง `code` ของ Star ที่ระบุผลพิมพ์ ดูตาราง [Status Codes](#16-printer-status-codes-อ้างอิง) ใน Section 16 — สำหรับ scope เรา interpret 2xx = สำเร็จ, อื่น = fail (ไม่ retry)

```typescript
async function handleDelete(mac: string, code: string | null) {
  const printer = await db.query.printers.findFirst({ where: eq(printers.macAddress, mac) });
  if (!printer) return new Response('not found', { status: 404 });

  const success = code?.startsWith('2') ?? false;
  await db.update(printJobs)
    .set({
      status: success ? 'done' : 'failed',
      errorMessage: success ? null : `printer code: ${code}`,
      printedAt: success ? new Date() : null,
    })
    .where(and(
      eq(printJobs.printerId, printer.id),
      eq(printJobs.status, 'printing'),
    ));

  return new Response('', { status: 204 });
}

export const DELETE = (req) => {
  const url = new URL(req.url);
  return handleDelete(url.searchParams.get('mac')!.toLowerCase(), url.searchParams.get('code'));
};
```

### 5.5 (Optional) `GET /api/cloudprnt-setting.json`

Static — บอก printer ว่า server รองรับ HTTP เท่านั้น

```typescript
export const GET = () => Response.json({
  title: 'star_cloudprnt_server_setting',
  version: '1.0.0',
  serverSupportProtocol: ['HTTP'],
});
```

---

## 6. Template (เริ่มที่ 1 ตัว)

`lib/templates/order.ts`

```typescript
export function renderOrder(payload: OrderPayload): string {
  const W = 32; // chars per line, รองรับ 58mm thermal
  const line = '-'.repeat(W);
  const center = (s: string) => s.padStart((W + s.length) / 2).padEnd(W);

  let out = '';
  out += center('ORDER') + '\n';
  out += line + '\n';
  out += `Order: ${payload.orderId}\n`;
  out += `Branch: ${payload.branchCode}\n`;
  if (payload.customerName) out += `Customer: ${payload.customerName}\n`;
  out += `Time: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}\n`;
  out += line + '\n';

  for (const item of payload.items) {
    out += `${item.qty}x ${item.name}\n`;
    out += `${' '.repeat(W - 8)}${item.price.toFixed(2).padStart(8)}\n`;
  }

  out += line + '\n';
  out += `TOTAL${payload.total.toFixed(2).padStart(W - 5)}\n`;
  if (payload.note) out += `Note: ${payload.note}\n`;
  out += '\n\n\n'; // feed paper before cut
  return out;
}
```

ภาษาไทยใช้ได้ใน `text/plain` ถ้า printer ตั้ง code page UTF-8 (TSP100IV รองรับ) ถ้า printer รุ่นเก่าอาจต้อง escape เป็น TIS-620 — ไว้ดูตอน E2E test

---

## 7. Admin UI (3 หน้า)

### 7.1 `/login`

Form กรอก password เดียว → ตรวจกับ `process.env.ADMIN_PASSWORD` → set HTTP-only cookie

### 7.2 `/` (Dashboard)

หน้าเดียวจบ:

```
┌─────────────────────────────────────────────────┐
│ PRINTERS                                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ Branch A   00:11:62:..  ● online   200 OK   │ │
│ │ Branch B   00:11:62:..  ● offline  -        │ │
│ │ Branch C   00:11:62:..  ● online   507 Cover│ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ RECENT JOBS                                      │
│ ┌─────────────────────────────────────────────┐ │
│ │ Time   Branch  OrderID  Status              │ │
│ │ 14:32  A       1234     ✓ done              │ │
│ │ 14:30  A       1233     ⟳ printing          │ │
│ │ 14:25  B       1232     ✗ failed [view]     │ │
│ │ ...                                         │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- Server Component, `revalidate = 10` (refresh ทุก 10 วินาที)
- Online = `last_seen_at` < 60 วินาที
- คลิก row → ไป `/jobs/[id]`

### 7.3 `/jobs/[id]`

- Status, timestamps, error message (ถ้ามี)
- Payload (JSON pretty)
- Rendered preview (`<pre>` แสดง output ของ `renderTemplate`)
- 2 ปุ่ม: **Retry** (set status = pending) + **Mark done** (manual close)

---

## 8. Auth (เรียบง่าย)

- **Zoho** → `x-api-key` header เทียบ `process.env.ZOHO_API_KEY`
- **Printer** → ระบุตัวด้วย MAC อย่างเดียว — ต้องมี printer record ใน DB (ไม่ register = ignore)
- **Admin** → password เดียวใน env var, middleware เช็ค cookie
  ```typescript
  // middleware.ts
  export function middleware(req: NextRequest) {
    if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next();
    if (req.nextUrl.pathname === '/login') return NextResponse.next();
    if (req.cookies.get('admin')?.value !== process.env.ADMIN_COOKIE_SECRET) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }
  ```

ไม่ต้องมี per-printer API key — ถ้าใครรู้ MAC ก็เคลม job ไปได้ในทาง theory แต่ scope ของลูกค้ารับได้

---

## 9. Cron (1 ตัว)

`vercel.json`
```json
{ "crons": [{ "path": "/api/cron/expire-stuck", "schedule": "*/10 * * * *" }] }
```

`app/api/cron/expire-stuck/route.ts` — ทุก 10 นาที งานค้าง `printing` > 10 นาที → mark `failed` (`Bearer ${CRON_SECRET}` check)

---

## 10. Env Variables (ครบทั้งหมด)

| Key | ที่มา | Production |
|---|---|---|
| `POSTGRES_URL` | Vercel auto | auto |
| `ZOHO_API_KEY` | สุ่ม 32 ไบต์ | กรอกเองใน Zoho config ด้วย |
| `ADMIN_PASSWORD` | ตั้งเอง | กับลูกค้า |
| `ADMIN_COOKIE_SECRET` | สุ่ม 32 ไบต์ | - |
| `CRON_SECRET` | สุ่ม 32 ไบต์ | - |

---

## 11. Cost (จริง)

| รายการ | ประมาณ |
|---|---|
| Vercel Pro | $20/เดือน (~700 บาท) |
| Vercel Postgres (รวมใน Pro) | 0 |
| Domain ปีแรก | ~500 บาท |
| **รวม** | **~700 บาท/เดือน** |

**Polling load:** 10 printer × ทุก 30 วินาที × 24 ชม. × 30 วัน = **864K invocations/เดือน** — fit in Pro (1M included)

ถ้าจะใช้ Hobby (free) → ตั้ง polling 5 นาที = 86K/เดือน fit แต่ใบเสร็จจะออกช้า 0–5 นาที (ไม่เหมาะร้านอาหาร)

> **แนะนำ:** Pro + polling 30 วินาที ใบเสร็จออก worst case 30 วินาทีหลัง Zoho submit

---

## 12. Timeline (3–4 วัน)

| วัน | งาน | Done when |
|---|---|---|
| **Day 1** | Bootstrap repo + Vercel + Postgres + schema migrate + admin login | login เข้า dashboard เปล่า ๆ ได้ |
| **Day 2** | `/api/zoho/orders` + `/api/cloudprnt` (POST/GET/DELETE) + render template | curl simulate flow ครบจบบน dev |
| **Day 3** | Admin Dashboard (printers + jobs list) + `/jobs/[id]` + cron expire-stuck | เปิด dashboard แล้วเห็นงานที่ test ใน Day 2 ครบ |
| **Day 4** | Test กับ Star Printer + Zoho Creator จริง, fix, deploy production, เขียน 1-page runbook | ปริ้นใบเสร็จออกจาก Zoho จริงสำเร็จ |

**Effort:** 3 man-days (~25,500 บาท) ตรงกลางระหว่าง Option A และ Option B ใน SoW

---

## 13. Test Plan (สั้น ๆ)

ก่อน go-live — 4 scenarios:

| # | Test | Expected |
|---|---|---|
| 1 | Zoho ยิง order → เห็นใน dashboard ภายใน 30s → printer พิมพ์ออก | ✓ ใบเสร็จออก, status = done |
| 2 | ปลั๊ก printer → Zoho ยิง order → ดูสถานะใน dashboard | printer offline, job pending |
| 3 | เสียบ printer กลับ | งานออกภายใน poll interval ถัดไป |
| 4 | Zoho ส่ง orderId ซ้ำ | ไม่พิมพ์ซ้ำ (idempotent insert) |

---

## 14. Setup ฝั่งลูกค้า (Day 4)

ฝั่ง **Zoho Creator** — ลูกค้า / WidelyNext setup
- เพิ่ม Action ใน form/workflow → POST ไป `https://<domain>/api/zoho/orders`
- Header: `x-api-key: <ZOHO_API_KEY>`
- Body: JSON ตาม schema ใน 5.1

ฝั่ง **Star Printer** (ทุกเครื่อง)
1. Login เข้าหน้าเว็บ printer
2. CloudPRNT settings:
   - Server URL: `https://<domain>/api/cloudprnt`
   - Polling: 30 seconds
3. Save + reboot
4. กลับมา insert row ใน `printers` table ด้วย MAC + branch_code (ผ่าน Drizzle Studio หรือ SQL)

---

## 15. Future Roadmap (ถ้าลูกค้าอยากต่อ)

ทำเป็นเฟส 2 ถ้าลูกค้า up-sell ภายหลัง:

- เพิ่ม template (kitchen ticket, customer receipt, refund slip)
- รองรับ logo / QR (เปลี่ยนจาก text/plain → StarPRNT raw command)
- LINE Notify เมื่อ printer offline > N นาที
- รายงานยอดขายรายวัน (export CSV)
- Multi-user admin

---

## 16. Printer Status Codes (อ้างอิง)

จาก Star CloudPRNT manual — ใช้ใน `last_status_code` (จาก POST body) และ DELETE `code` parameter

### 2xx — Online / Normal (printer พร้อม)

| Code | ความหมาย | Action |
|---|---|---|
| 200 | OK | งานพิมพ์สำเร็จ → mark `done` |
| 201 | Output paper taken | ปกติ |
| 211 | Paper low | ปกติ — แต่ admin ดูไว้ |
| 220 | Printing in progress | ปกติ |
| 221 | Output paper present | รอลูกค้าฉีกใบเสร็จ |
| 230 | Cleaning notification | maintenance reminder |
| 231 | Parts replacement | maintenance reminder |

### 4xx — Printer Hardware Error

| Code | ความหมาย | Dashboard ควรแสดง |
|---|---|---|
| 410 | Out of paper | 🔴 "กระดาษหมด" |
| 411 | Paper jam | 🔴 "กระดาษติด" |
| 412 | Roll position error | 🔴 "ม้วนกระดาษไม่ถูกตำแหน่ง" |
| 420 | Cover open | 🔴 "ฝาเปิดอยู่" |

### 5xx — Job Processing Error

| Code | ความหมาย | Action ของเรา |
|---|---|---|
| 510 | Incompatible media type | mark `failed` (template มีปัญหา) |
| 511 | Media decoding error | mark `failed` (payload หรือ render พัง) |
| 512 | Unsupported media version | mark `failed` |
| 520 | Download timeout | คงสถานะ `printing` ไว้ — printer จะ retry GET เอง (cron expire-stuck จะเก็บถ้าเกินเวลา) |
| 521 | Job too large | mark `failed` (template ยาวเกิน) |

> **ข้อสำคัญ — Code 520 (download timeout):** อย่าเปลี่ยนเป็น `failed` เพราะเป็น network issue ฝั่ง printer printer จะลอง GET อีกครั้งเอง (ของเรา GET เป็น idempotent อยู่แล้ว) cron expire-stuck (ดู Section 9) จะ clean up ถ้าเกิน 10 นาที

ปรับ DELETE handler ให้ฉลาดขึ้น (optional — ถ้าอยาก match ตาม Star spec):

```typescript
async function handleDelete(mac: string, code: string | null) {
  // ... lookup printer ...

  // Code 520 = network timeout — อย่าเคลียร์งาน ปล่อย printer retry GET
  if (code === '520') return new Response('', { status: 204 });

  const success = code?.startsWith('2') ?? false;
  // ... update job as before ...
}
```

### Server response error codes (1xxx) — เกิดเมื่อ server ตอบ JSON ผิด — ไม่น่าเจอถ้าทำตาม spec
- 1000: JSON format error
- 1001: Missing required key
- 1200: Cannot print — printer busy
- 1201/1202: jobToken issue

---

## 17. CloudPRNT Protocol — สรุปจาก Official Manual

### POST request body (จาก printer)

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `statusCode` | string | **✓** | 3-4 หลัก + คำอธิบาย URL-encoded เช่น `"200%20OK"` |
| `printerMAC` | string | optional | Ethernet MAC (เป็น Ethernet เสมอ แม้ใช้ wireless) |
| `uniqueID` | string | optional | server-assigned ID |
| `jobToken` | string | optional | แนบมาเฉพาะระหว่าง job in progress |
| `printingInProgress` | boolean | optional | `true` = พิมพ์อยู่ (ใช้ดู missed DELETE) |
| `clientAction` | array | optional | response เมื่อ server เคยถาม (เราไม่ใช้) |
| `status` | string | optional | Star ASB hex |

### POST response body (จาก server)

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `jobReady` | boolean | **✓** | true/false |
| `mediaTypes` | array | optional* | required เมื่อ `jobReady=true` |
| `jobToken` | string | optional | ผูก GET/DELETE กับ job ที่ระบุ |
| `deleteMethod` | string | optional | `"DELETE"` (default) หรือ `"GET"` |
| `clientAction` | array | optional | ขอข้อมูล printer (เราไม่ใช้) |
| `jobGetUrl` | string | optional | redirect printer ไปดึง content จาก URL อื่น |
| `jobConfirmationUrl` | string | optional | redirect DELETE ไป URL อื่น |

### DELETE query parameters

| Param | หมายเหตุ |
|---|---|
| `mac` | MAC address |
| `code` | Status code ผลพิมพ์ (URL-encoded) |
| `token` | jobToken ที่ server ส่งใน POST response (ถ้าได้) |

### Idempotency rules ที่สำคัญ

- **POST** มี side effect: update last_seen, status code
- **GET** ต้อง idempotent: ยิงซ้ำได้ content เดิมจน POST/DELETE เปลี่ยน state
- **DELETE** เป็น state transition สุดท้าย — เคลียร์ job

### Recommended media types

สำหรับ scope นี้ใช้ `text/plain` ทุก printer รองรับ ภาษาไทย UTF-8 ใช้ได้บน mC-Print2/3, TSP100IV, mC-Label3

ถ้าจะ upgrade ภายหลัง (logo, cut, barcode) ใช้ `application/vnd.star.starprntcore` รองรับเครื่องส่วนใหญ่กว่า `application/vnd.star.starprnt`
- Move to MQTT (ลด polling cost)
