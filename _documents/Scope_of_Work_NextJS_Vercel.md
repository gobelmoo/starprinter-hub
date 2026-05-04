# เอกสารขอบเขตงาน (Scope of Work)
## ระบบสั่งพิมพ์ใบเสร็จผ่าน Cloud Printer
### Cloud Receipt Printing Middleware — Next.js + Vercel Edition

| รายการ | ข้อมูล |
|---|---|
| เสนอให้ | คุณเผ่าเทพ |
| จัดทำโดย | Widely Next Co., Ltd. |
| เวอร์ชัน | 2.0 (Updated technical stack: Next.js + Vercel) |
| อ้างอิง | Proposal_Cloud_Printer_WidelyNext.pdf (April 2026) |
| วันที่จัดทำ | พฤษภาคม 2026 |

---

## 1. ภาพรวมโครงการ (Project Overview)

โครงการพัฒนา **Cloud Receipt Printing Middleware** เพื่อทำหน้าที่เป็นตัวกลางระหว่างระบบ ERP/Form ของลูกค้า (Zoho Creator) กับเครื่องพิมพ์ Star Printer ที่กระจายอยู่ตามสาขา (สูงสุด 7 เครื่อง) โดยใช้สถาปัตยกรรมแบบ **Polling-based CloudPRNT** ซึ่งเป็น protocol มาตรฐานของ Star Micronics

เอกสารฉบับนี้เป็นการปรับปรุงจาก Proposal เดิม โดยเปลี่ยน technical stack จาก PHP + Free Hosting → **Next.js (App Router) + Vercel** เพื่อให้ได้คุณสมบัติเหล่านี้

- **Serverless / Auto-scale** — ไม่ต้องดูแลเซิร์ฟเวอร์, รองรับโหลด polling จาก 7 เครื่องได้สบาย
- **HTTPS + Custom Domain อัตโนมัติ** — Vercel จัดการ TLS certificate ให้ทั้งหมด
- **CI/CD ในตัว** — push Git → deploy ทันที, มี Preview environment สำหรับทดสอบ
- **Observability** — มี log, metric, ติดตามได้จาก Vercel Dashboard
- **Type-safe end-to-end** — TypeScript ตั้งแต่ DB → API → UI ลด bug ในการ deploy production

### วัตถุประสงค์หลัก (Objectives)

ตรงตาม Proposal เดิม คือ

1. รับข้อมูลพิมพ์จาก Zoho Creator ผ่าน API/Webhook + Header Authentication
2. ระบบ Polling ให้ Star Printer ดึงงานพิมพ์ทุก 5–10 วินาที (ปรับได้)
3. Routing งานพิมพ์ไปยังเครื่องที่ถูกต้องตาม **JobID Prefix** หรือ **Branch Code**
4. คิวงานแบบ FIFO (Sequential per printer)
5. หน้า Admin UI สำหรับ Config และ Monitoring สถานะ
6. Logging สถานะการพิมพ์ทั้ง Success / Failed พร้อม Error Message

---

## 2. สถาปัตยกรรมระบบ (System Architecture)

```
┌─────────────────┐                   ┌──────────────────────────────┐
│  Zoho Creator   │  HTTPS Webhook    │       Vercel (Next.js)       │
│  (ERP / Form)   │ ─────────────────►│  ┌────────────────────────┐  │
└─────────────────┘   x-api-key       │  │ /api/zoho/jobs (POST)  │  │
                                      │  └─────────┬──────────────┘  │
                                      │            │ enqueue          │
                                      │            ▼                  │
                                      │  ┌────────────────────────┐  │
                                      │  │  Vercel Postgres       │  │
                                      │  │   • printers           │  │
                                      │  │   • print_jobs (queue) │  │
                                      │  │   • job_events (log)   │  │
                                      │  │   • templates          │  │
                                      │  └─────────┬──────────────┘  │
                                      │            │                  │
                                      │  ┌─────────▼──────────────┐  │
┌────────────────┐  HTTPS Poll/GET    │  │ /api/cloudprnt/[id]    │  │
│ Star Printer 1 │ ──────────────────►│  │ (Edge Function)        │  │
│ Star Printer 2 │                    │  └────────────────────────┘  │
│   ... (≤7)     │                    │                              │
└────────────────┘                    │  ┌────────────────────────┐  │
                                      │  │  Admin UI (App Router) │  │
┌────────────────┐ ◄──────────────────│  │  /dashboard /printers  │  │
│  Admin (Web)   │  HTTPS + Auth      │  │  /jobs /templates      │  │
└────────────────┘                    │  └────────────────────────┘  │
                                      └──────────────────────────────┘
```

### การไหลของข้อมูล (Data Flow)

1. **รับงาน** — Zoho Creator ยิง Webhook → `/api/zoho/jobs` → ตรวจ API key → คำนวณ printer ที่จะส่งจาก Routing rule → INSERT แถวใน `print_jobs` (status: `pending`)
2. **เครื่องพิมพ์ poll** — Star Printer ส่ง POST → `/api/cloudprnt/[printerId]` → query `print_jobs` ของ printer นี้ที่ยัง pending → ตอบ `{ jobReady: true, mediaTypes: [...] }`
3. **เครื่องพิมพ์ดึงเนื้อหา** — Star Printer ส่ง GET → claim job (UPDATE status → `printing`) → render template + payload → return เป็น `text/plain` หรือ StarPRNT raw command
4. **เครื่องพิมพ์ confirm** — Star Printer ส่ง DELETE (CloudPRNT v2) → mark job `done` พร้อม timestamp
5. **Log** — ทุก state transition บันทึกลง `job_events` สำหรับ Monitoring UI

---

## 3. Technology Stack

| ชั้น | เทคโนโลยี | เหตุผลการเลือก |
|---|---|---|
| Framework | **Next.js 16 (App Router, TypeScript)** | Server Components, Server Actions, ได้ทั้ง API + UI ในโปรเจกต์เดียว |
| Hosting | **Vercel** | First-party Next.js host, HTTPS + Edge + CI/CD ครบ |
| Database | **Vercel Postgres (Neon)** | SQL ใช้กับ queue ได้ดี (`FOR UPDATE SKIP LOCKED`), managed, scale ได้ |
| ORM | **Drizzle ORM** | Type-safe, lightweight, ทำงานดีกับ serverless |
| UI | **Tailwind CSS + shadcn/ui** | Components คุณภาพดี ปรับแต่งง่าย เข้ากับ Next.js |
| Auth (Admin) | **Auth.js (NextAuth) + Email/Password** | สำหรับผู้ดูแลระบบ ภายในไม่กี่ users |
| Auth (Zoho) | **Header API Key** | Shared secret ตรวจที่ middleware level |
| Auth (Printer) | **Per-printer API Key + MAC verify** | ให้แต่ละเครื่องพิมพ์มี secret ของตัวเอง |
| Form / Validation | **Zod** | Validate ทุก input ทั้งฝั่ง client/server |
| Background Jobs | **Vercel Cron** | สำหรับ cleanup, retry, daily report |
| Observability | **Vercel Logs + Drizzle Studio + Web Analytics** | ดู metric, ดู query, ดู behavior |

---

## 4. ขอบเขตการทำงาน (Scope of Work)

ขอบเขตคงตาม Proposal เดิม 7 หัวข้อ + ระบุ implementation บน Next.js/Vercel

### 4.1 การรับข้อมูลจาก Zoho Creator

| หัวข้อ | รายละเอียด |
|---|---|
| Endpoint | `POST /api/zoho/jobs` (Vercel Function, Node.js runtime) |
| Auth | Header `x-api-key` ตรวจกับค่าใน DB ตาราง `api_clients` |
| Request body | JSON: `{ jobId, printerHint?, branchCode?, templateCode, payload }` |
| Validation | Zod schema — reject 400 พร้อมข้อความ error ถ้าผิด |
| Response | `201 { jobId, status: "queued", printerId }` หรือ `4xx { error }` |
| Idempotency | ใช้ `jobId` จาก Zoho เป็น unique key — กัน webhook ซ้ำ |

### 4.2 ระบบ Polling (CloudPRNT Endpoint)

| หัวข้อ | รายละเอียด |
|---|---|
| Endpoint | `POST/GET/DELETE /api/cloudprnt/[printerId]` (Edge runtime) |
| Polling interval | กำหนดที่เครื่องพิมพ์ Star (default 10s, แนะนำ 5–30s) |
| POST behavior | ตอบ `{ jobReady, mediaTypes, jobToken }` — ตรวจมีงาน pending หรือไม่ |
| GET behavior | Render template + return content + เปลี่ยน status `pending → printing` |
| DELETE behavior | mark `done` ลบ token, log timestamp |
| Identification | ตรวจ `printerId` ใน path + verify `printerMAC` ใน body POST |

### 4.3 การกำหนด Printer (Routing)

| หัวข้อ | รายละเอียด |
|---|---|
| Strategy 1 | **JobID Prefix** — เช่น `BKK-0001` → printer ที่กำหนด prefix `BKK-` |
| Strategy 2 | **Branch Code** — field `branchCode` ใน payload → ตาราง `printer_routes` |
| Strategy 3 (fallback) | Direct `printerId` ใน payload (override) |
| Configurable | จัดการผ่านหน้า Admin UI `/printers` (ไม่ต้อง redeploy) |
| รองรับ | เครื่องพิมพ์สูงสุด 7 เครื่อง (validate ระดับ business rule) |

### 4.4 การสั่งพิมพ์ + Templates

| หัวข้อ | รายละเอียด |
|---|---|
| จำนวน Template | 3 ชุด (ตาม Proposal เดิม) |
| Template engine | TypeScript function: `(payload) => string` (plain text) หรือ `Buffer` (StarPRNT raw) |
| ผลลัพธ์ที่ส่งกลับ | `text/plain` (default) หรือ `application/vnd.star.starprnt` |
| ความยืดหยุ่น | แต่ละ template เก็บใน source code (review ผ่าน PR ได้) — ไม่ใช่ user-editable HTML |
| ตัวอย่าง Template | (1) ใบเสร็จขาย, (2) ใบปิดงาน/บิลย่อย, (3) ใบกำกับการจัดส่ง — กำหนดร่วมกับลูกค้าใน Phase 1 |

### 4.5 ระบบคิวงาน (FIFO Queue)

| หัวข้อ | รายละเอียด |
|---|---|
| Storage | Vercel Postgres ตาราง `print_jobs` |
| Ordering | `ORDER BY created_at ASC` ภายในแต่ละ `printer_id` |
| Atomic claim | `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` กัน race condition |
| Retry | กรณี printer fetch แล้วไม่ confirm ภายใน 60s → คืน status เป็น `pending` (ผ่าน Vercel Cron) |
| Visibility | ดูทุกงานในคิวได้จาก Admin UI `/jobs?status=pending` |

### 4.6 Admin UI (Config & Monitoring)

| หน้า | ความสามารถ |
|---|---|
| `/login` | Email + Password (Auth.js) |
| `/dashboard` | สรุปวันนี้: งานที่พิมพ์สำเร็จ/ล้มเหลว, สถานะเครื่องพิมพ์ทั้งหมด (online/offline), งานคงค้าง |
| `/printers` | ลิสต์, เพิ่ม, แก้ไข, ลบ printer (≤ 7) — กำหนด name, branchCode, jobPrefix, MAC, pollInterval |
| `/printers/[id]` | รายละเอียดเครื่อง: สถานะ, last-seen, งาน 50 รายการล่าสุด |
| `/jobs` | ลิสต์งานพิมพ์ทั้งหมด, filter ตาม status / printer / date range |
| `/jobs/[id]` | รายละเอียดงาน: payload, rendered output (preview), event log |
| `/templates` | ดูตัวอย่าง 3 templates พร้อม sample payload |
| `/settings` | API Keys (rotate ได้), Zoho endpoint config, polling default |

UI ใช้ shadcn/ui + Tailwind, responsive, dark mode

### 4.7 ระบบ Log

| หัวข้อ | รายละเอียด |
|---|---|
| Storage | ตาราง `job_events` (jobId, event, message, createdAt) |
| Events ที่บันทึก | `received`, `routed`, `claimed`, `printed`, `failed`, `retry`, `expired` |
| Retention | 90 วัน (cleanup ผ่าน Vercel Cron รายวัน) |
| Export | ดาวน์โหลด CSV ตามช่วงวันที่ จาก `/jobs` |
| Alert | (Optional add-on) ส่ง Email/LINE Notify เมื่อ failed > N ครั้งใน X นาที |

---

## 5. โครงสร้างฐานข้อมูล (Data Model)

```
api_clients
  id, name, api_key_hash, created_at, revoked_at

printers
  id, name, branch_code, job_prefix, mac_address,
  api_key_hash, poll_interval_sec, status,
  last_seen_at, created_at, updated_at

print_jobs
  id, printer_id (FK), source_job_id (Zoho), template_code,
  payload (jsonb), status (pending|printing|done|failed|expired),
  attempts, error_message, created_at, claimed_at, printed_at

job_events
  id, job_id (FK), event, message, created_at

users        -- admin
  id, email, password_hash, role, created_at
```

---

## 6. Security

- **Authentication**
  - Zoho → server: shared `x-api-key` (ใน Vercel env var)
  - Printer → server: per-device API key + MAC verify
  - Admin → server: Auth.js (email/password + bcrypt + httpOnly cookie)
- **Transport** — HTTPS เท่านั้น (Vercel auto)
- **Secrets** — เก็บใน Vercel Environment Variables (Production / Preview / Development แยกกัน)
- **Rate limit** — `/api/zoho/jobs` จำกัด 60 req/min ต่อ IP/key
- **Audit** — ทุก mutation ที่ Admin UI ทำ log ลง `job_events` หรือ admin audit table
- **CSRF / XSS** — ใช้ Auth.js + Server Actions ที่ป้องกันมาตรฐานในตัว Next.js

---

## 7. Hosting & Operating Cost

| รายการ | ขั้นต่ำ | แนะนำ |
|---|---|---|
| Vercel Plan | Hobby (free) | **Pro ($20/mo)** |
| Vercel Postgres | included (Hobby quota) | Pro tier (เพียงพอ) |
| Domain | จัดหาให้ (1 โดเมน, ปีแรก) | จัดหาให้ |
| TLS / HTTPS | ✓ included | ✓ included |

**ข้อสังเกตสำคัญเรื่อง polling load:**

- 7 เครื่องพิมพ์ × poll ทุก 5 วินาที × 24 ชม. × 30 วัน ≈ **3.6 ล้าน function invocations/เดือน**
- Vercel Hobby = 100K invocations/เดือน (จะเกินทันที)
- Vercel Pro = 1M invocations รวมในแพ็ค + $0.40 ต่อ 1M เพิ่มเติม → **ประมาณ $20–22/เดือน รวม**
- ทางเลือกลดต้นทุน: ตั้ง polling interval เป็น 15–30 วินาที หรือใช้ Edge runtime (cheaper invocation)

> **คำแนะนำ:** เริ่มที่ Pro plan + polling 10 วินาที เป็น sweet spot ระหว่างต้นทุนกับ responsiveness

---

## 8. แผนการดำเนินงาน (Project Plan)

ระยะเวลาดำเนินการรวม **7 วันทำการ** แบ่งเป็น 4 ระยะ (เพิ่มจาก 5 วันเดิม เพราะการตั้ง DB + Auth + UI ครบบน Next.js ต้องใช้เวลามากกว่า PHP file-based)

| วัน | ระยะ | รายการงาน | ผลลัพธ์ |
|---|---|---|---|
| **วัน 1** | Phase 1: Setup & Architecture | สร้างโปรเจกต์ Next.js, ตั้ง Vercel project, link Postgres, schema design, Auth.js setup, ออกแบบ API spec, agree 3 templates | Repo + DB + Vercel project พร้อมใช้, Architecture doc |
| **วัน 2–4** | Phase 2: Core Development | `/api/zoho/jobs` (Webhook receiver), `/api/cloudprnt/[id]` (CloudPRNT endpoint), Routing engine, FIFO queue (Postgres locking), 3 print templates, retry cron | Core middleware ทำงานครบ end-to-end ผ่าน automated test |
| **วัน 5–6** | Phase 3: Admin UI & Logging | หน้า Login, Dashboard, Printers CRUD, Jobs list/detail, Templates preview, Settings, Audit logging | Admin UI ใช้งานได้ครบ, log บันทึกครบ event |
| **วัน 7** | Phase 4: Testing & Handover | E2E test กับ Zoho Creator + Star Printer จริง (รายละเอียดที่ลูกค้าจัดเตรียม), Bug fix, deploy production, ส่งเอกสาร handover | ระบบ Production-ready พร้อม runbook |

---

## 9. การส่งมอบ (Deliverables)

1. **Source code** ใน Git repository (GitHub) — ลูกค้าได้ owner/admin
2. **Vercel project** deploy production พร้อมโดเมน (`xxx.widelynext.com` หรือโดเมนลูกค้า)
3. **Database schema** + migration scripts (Drizzle Kit)
4. **Environment variable list** + คำอธิบายแต่ละตัว
5. **Admin บัญชีผู้ดูแล** อย่างน้อย 1 บัญชี + คู่มือสร้างเพิ่ม
6. **API Documentation** — endpoint, request/response, ตัวอย่างเรียกจาก Zoho
7. **Runbook** — วิธี deploy ใหม่, rotate API key, ดู log, ดึง CSV
8. **3 Print Templates** ตามที่ลูกค้าระบุ (Phase 1)
9. **UAT Support** ระหว่าง Phase 4
10. **Bug fix support 30 วัน** หลังส่งมอบ (เฉพาะ defect ที่เกิดจากการพัฒนา)

---

## 10. ราคาค่าบริการ (Pricing)

> **หมายเหตุ:** Stack ใหม่มี surface area เพิ่มขึ้น (Auth, DB, ORM, Admin UI ครบ, CI/CD setup) — เสนอ 2 ทางเลือกให้พิจารณา

### Option A — เต็มสโคป Recommended

| รายการ | จำนวน | อัตรา | รวม |
|---|---|---|---|
| ค่าพัฒนาระบบ | 5 man-days | 8,500 บาท | **42,500 บาท** |
| (ราคาก่อน VAT)  |  |  |  |

### Option B — MVP Scope (อิงตาม Proposal เดิม)

ตัด/ลดบางส่วนเพื่อให้พอดีงบประมาณเดิม

- Admin UI เฉพาะหน้า Printers + Jobs (ไม่มี Dashboard, Templates, Settings preview)
- 1 Template เริ่มต้น (อีก 2 พัฒนาเพิ่มภายหลัง)
- ไม่มี Audit log + CSV export
- ไม่มี Auth multi-user (single admin password)

| รายการ | จำนวน | อัตรา | รวม |
|---|---|---|---|
| ค่าพัฒนาระบบ | 2.5 man-days | 8,500 บาท | **21,250 บาท** |
| (ราคาก่อน VAT)  |  |  |  |

### ค่าใช้จ่ายต่อเดือน (Operating Cost — ลูกค้ารับผิดชอบหลังส่งมอบ)

| รายการ | ประมาณการ |
|---|---|
| Vercel Pro | ~$20/เดือน (~700 บาท) |
| Vercel Postgres | included ใน Pro tier |
| Domain | ~500 บาท/ปี |
| **รวม** | **~700–900 บาท/เดือน** |

---

## 11. เงื่อนไขการชำระเงิน (Payment Terms)

| งวด | เงื่อนไข | จำนวนเงิน (Option A) | จำนวนเงิน (Option B) |
|---|---|---|---|
| งวดที่ 1 | 50% เมื่อลงนาม (Kick-off) | 21,250 บาท | 10,625 บาท |
| งวดที่ 2 | 50% เมื่อส่งมอบ (Final Delivery) | 21,250 บาท | 10,625 บาท |

---

## 12. สิ่งที่รวม / ไม่รวมในข้อเสนอนี้

### สิ่งที่รวม

- พัฒนาระบบตาม Scope of Work ครบ 7 ส่วน (ตาม Option ที่เลือก)
- Source code (Git, full ownership ของลูกค้า)
- Setup Vercel project + Postgres + Domain (ปีแรก)
- การทดสอบกับลูกค้า (UAT support)
- Bug fix 30 วันหลังส่งมอบ

### สิ่งที่ไม่รวม

- ค่า Vercel/Postgres/Domain เดือนถัดไป (ตามตารางข้อ 10)
- ค่า License Zoho Creator
- การพัฒนา feature นอก Scope (เปลี่ยนแปลงระหว่างทาง = ปรับ timeline + ราคา)
- Maintenance หลัง 30 วัน (ตกลงแยกเป็นรายเดือนได้)
- การ integrate กับระบบอื่นนอกเหนือ Zoho Creator
- การ training ผู้ใช้ปลายทาง (มีคู่มือให้)

### ข้อกำหนดอื่น

- ลูกค้าจัดเตรียม **Spec ของ 3 Document Templates** ให้ครบใน Phase 1
- ลูกค้าจัดเตรียม **Star Printer + Zoho Creator account** สำหรับ E2E test ใน Phase 4
- ลูกค้าตั้ง **Admin email** + **shared API key สำหรับ Zoho** ก่อน go-live

---

## 13. ความแตกต่างจาก Proposal เดิม

ตารางสรุปสิ่งที่เปลี่ยนเพื่อความโปร่งใส

| หัวข้อ | Proposal เดิม | Edition นี้ |
|---|---|---|
| Stack | PHP + Free Hosting | Next.js 16 + Vercel |
| Database | (ไม่ระบุ — น่าจะ file-based) | Vercel Postgres |
| HTTPS / Domain | ผู้ให้บริการจัด | ผู้ให้บริการจัด (ผ่าน Vercel) |
| Hosting cost | "Free" (ไม่ระบุชัด) | ~700 บาท/เดือนหลังส่งมอบ |
| Timeline | 5 วัน, 2.5 man-days | 7 วัน, 5 man-days (Option A) / คงเดิม (Option B) |
| ราคา | 21,250 บาท | 42,500 / 21,250 บาท |
| Type safety | — | TypeScript end-to-end |
| Multi-user admin | — | ✓ (Option A) |
| Audit log + CSV export | — | ✓ (Option A) |
| Auto deploy / Preview | — | ✓ (CI/CD ผ่าน Vercel) |

---

## 14. การยืนยันข้อเสนอ (Acceptance)

หากท่านเห็นชอบกับ SoW ฉบับนี้ กรุณาเลือก **Option** และลงนามตอบกลับ

**ฝ่ายผู้ให้บริการ (Service Provider)**
- ชื่อ: นางสาวสุรารักษ์ จินตวงศ์วานิช
- ตำแหน่ง: Project Manager
- บริษัท: Widely Next Co., Ltd.
- วันที่: ____________

**ฝ่ายลูกค้า (Client)**
- ชื่อ: ____________
- ตำแหน่ง: ____________
- บริษัท: ____________
- Option ที่เลือก: ☐ A (เต็มสโคป — 42,500 บาท)  ☐ B (MVP — 21,250 บาท)
- วันที่: ____________

---

*ขอบคุณสำหรับโอกาสในการให้บริการ | Thank you for the opportunity*
