# API Reference — Star Printer Hub

เอกสารสำหรับทีม Zoho Creator integrator (หรือระบบอื่นที่จะส่ง print job)

---

## Base URL

| Environment | URL |
|---|---|
| Production | `https://starprinter-hub.vercel.app` |
| Local dev | `http://localhost:3000` |

---

## Authentication

Header `x-api-key` ที่ตรงกับ `ZOHO_API_KEY` ใน Vercel environment

WidelyNext จะส่ง key ให้ทีม Zoho ผ่านช่องทางที่ปลอดภัย (1Password / sealed envelope) — **ห้ามวางใน code repo**

---

## Endpoint

### `POST /api/print/jobs`

ส่ง print job เข้าคิว ใบเสร็จจะออกที่ printer ภายใน polling interval (default 5 วินาที)

#### Headers

| Header | Required | Value |
|---|---|---|
| `Content-Type` | ✓ | `application/json` |
| `x-api-key` | ✓ | shared secret ที่ WidelyNext จัดให้ |

#### Request Body (JSON)

```json
{
  "printerId": "725691e6-eec5-4724-ace4-4321c8683ff4",
  "jobId":     "ORD-20260505-0001",
  "markup":    "[align: centre]ใบเสร็จ\n[cut]"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `printerId` | UUID | ✓ | id ของเครื่องพิมพ์ในระบบ — ดูที่ admin UI `/printers` |
| `jobId` | string | ✓ | unique key ส่งซ้ำด้วย jobId เดิม จะ return `duplicate` ไม่พิมพ์ซ้ำ |
| `markup` | string | ✓ | Star Document Markup — ดู spec ที่ส่วน "Markup" ด้านล่าง |

#### Response

**สำเร็จ — เพิ่มงานใหม่ (HTTP 200)**
```json
{
  "ok": true,
  "status": "queued",
  "id": "2cbebcea-7aed-4fdc-937b-78e54f8c3974",
  "jobId": "ORD-20260505-0001"
}
```

**สำเร็จ — jobId ซ้ำ (HTTP 200)**
```json
{
  "ok": true,
  "status": "duplicate",
  "jobId": "ORD-20260505-0001"
}
```
Zoho **ไม่ควร retry** — งานนี้ถูก queue ไปแล้วก่อนหน้า

**Auth ผิด (HTTP 401)** — `Unauthorized` — ตรวจ `x-api-key`

**Validation ผิด (HTTP 400)**
```json
{
  "error": "Invalid payload",
  "issues": [{ "code": "...", "path": ["..."], "message": "..." }]
}
```

**Printer ไม่พบ (HTTP 400)**
```json
{ "error": "Printer <uuid> not found or inactive" }
```

---

## Star Document Markup

ระบบ render markup → StarPRNT command bytes ผ่าน Star CPUtil ดังนั้นรองรับ tag ตามสเปกของ Star เต็ม (ส่วนใหญ่ที่ใช้บ่อย)

อ้างอิง: https://cloudprnt.net/CloudPRNTSDK/Documentation/articles/markup/markupintro.html

### Tags ที่รองรับ

| Tag | คำอธิบาย |
|---|---|
| `[align: centre|left|right]` | จัดวางข้อความ (`[align]` = reset เป็น left) |
| `[mag: w N; h N]` หรือ `[magnify: width N; height N]` | ขยายตัวอักษร 1×–6× |
| `[mag]` / `[magnify]` | reset 1×1 |
| `[bold]` ... `[/bold]` | ตัวหนา |
| `[underline]` / `[/underline]` | ขีดเส้นใต้ |
| `[font: a|b]` | เลือก font |
| `[image: url URL; width N%; min-width Xmm]` | embed รูปจาก URL |
| `[barcode: type code39; data 1234; height 15mm; module 0; hri]` | barcode |
| `[qrcode: data ...]` | QR code |
| `[column: left: ...; right: ...]` | จัด columns |
| `[feed: lines N]` | feed กระดาษ N บรรทัด |
| `[cut: feed; partial]` หรือ `[cut]` | ตัดกระดาษ — **ผู้ส่งต้องใส่เอง** |
| `\` ท้ายบรรทัด | soft newline (ไม่ขึ้นบรรทัดใหม่จริง) |

### ตัวอย่างเต็ม

```
[align: centre][mag: w 2; h 2]ใบเสร็จ[mag]

[align: left]
[column: left: ผัดไทย ×2;     right: 240.00]
[column: left: ต้มยำ ×1;      right: 80.00]
[align: right][bold]TOTAL 320.00[/bold]
[align: centre]
[feed: lines 2]
ขอบคุณค่ะ
[feed: lines 3]
[cut]
```

ภาษาไทย UTF-8 ใช้ได้ตรง ๆ — Star CPUtil จัดการ encoding ภายใน

---

## Behavior Details

### Idempotency

ใช้ `jobId` เป็น unique key ในระดับ DB (column `source_job_id` เป็น unique)
- ส่ง `jobId` ซ้ำ → return `status:duplicate` ไม่ insert ซ้ำ ไม่พิมพ์ซ้ำ
- ปลอดภัยให้ retry network error ด้วย `jobId` เดิม

### Latency

- Webhook → server: < 500ms (sync)
- Job queued → ใบเสร็จออก: 0–5 วินาที (ขึ้นกับ polling interval)
- cputil markup → bytes: < 100ms ปกติ (cold start ครั้งแรก ~500ms)

### Retry policy ฝั่ง Zoho

- HTTP 5xx หรือ timeout → retry 3 ครั้ง (exponential backoff)
- HTTP 4xx → **ห้าม retry** — แก้ payload ก่อน
- HTTP 200 status:duplicate → ไม่ retry

---

## Example: Zoho Creator Workflow

ใน Zoho Creator → Form/Workflow → Action: **Send HTTP Request**

```
URL:     https://starprinter-hub.vercel.app/api/print/jobs
Method:  POST
Type:    JSON

Headers:
  x-api-key: <ZOHO_API_KEY>
  Content-Type: application/json

Body:
{
  "printerId": "<printer-uuid-จากระบบ>",
  "jobId":     <%input.OrderID%>,
  "markup":    <%markup-builder-output%>
}
```

ทีม Zoho สร้าง markup ฝั่งตัวเองด้วย Deluge string concat แล้วส่งมาทั้ง string

---

## Future Endpoints (ยังไม่มีในเวอร์ชันนี้)

- `GET /api/jobs/:jobId` — query สถานะ
- `POST /api/jobs/:jobId/cancel` — ยกเลิกก่อนพิมพ์
- `GET /api/printers` — list printer + สถานะ

ตอนนี้ดูสถานะผ่าน Admin UI ของ Star Printer Hub
