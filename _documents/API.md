# API Reference — Star Printer Hub

เอกสารสำหรับทีม integrator (Zoho Creator, Make, n8n, custom backend) ที่จะส่ง print job เข้าระบบ

---

## Base URL

| Environment | URL |
|---|---|
| Production | `https://starprinter-hub.vercel.app` |
| Local dev | `http://localhost:3000` |

---

## Authentication

Header `x-api-key` ตรงกับ secret ที่ WidelyNext แจ้งให้ (เก็บใน Vercel env เป็น `PRINT_API_KEY`)

ส่ง key ผ่านช่องทางที่ปลอดภัย (1Password / sealed envelope) — **ห้ามวางใน code repo**

---

## Endpoint

### `POST /api/print/jobs`

ส่ง print job เข้าคิว ใบเสร็จจะออกที่ printer ภายใน polling interval (default 5 วินาที)

#### Headers

| Header | Required | Value |
|---|---|---|
| `Content-Type` | ✓ | `application/json` |
| `x-api-key` | ✓ | secret ที่ WidelyNext แจ้งให้ |

#### Request Body (JSON)

```json
{
  "printerId":   "725691e6-eec5-4724-ace4-4321c8683ff4",
  "referenceId": "ORD-20260505-0001",
  "markup":      "[align: centre]ใบเสร็จ\n[cut]"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `printerId` | UUID | ✓ | id ของเครื่องพิมพ์ในระบบ — ดูที่ admin UI `/printers` |
| `referenceId` | string | ✗ | รหัสอ้างอิงฝั่งคุณ (order id, ticket no., ฯลฯ) — ส่งซ้ำได้ ไม่ dedup |
| `markup` | string | ✓ | Star Document Markup — ดู spec ที่ส่วน "Markup" |

#### Response

**สำเร็จ (HTTP 200)**
```json
{
  "ok": true,
  "jobId": "2cbebcea-7aed-4fdc-937b-78e54f8c3974",
  "referenceId": "ORD-20260505-0001"
}
```

`jobId` เป็น UUID ที่ระบบ generate ให้ ใช้สำหรับ trace กลับมาดูสถานะใน admin UI `/jobs/<jobId>`

**Auth ผิด (HTTP 401)** — `Unauthorized`

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

## Behavior Details

### No idempotency

ทุก request = 1 job ใหม่ ระบบไม่ dedup จาก `referenceId` แม้ส่งซ้ำ

**คำเตือนสำหรับ network retry**

ถ้า client ส่งแล้ว timeout/disconnect ก่อนได้ response แต่ server insert สำเร็จ → retry ครั้งที่ 2 จะสร้าง job ใหม่อีก = พิมพ์ซ้ำ

แนวทางป้องกัน
- ฝั่ง client เก็บผลลัพธ์ (jobId) ทุกครั้งที่ได้ response → retry เฉพาะกรณีที่แน่ใจว่าไม่ถึง server (เช่น network refused)
- หรือยอมรับว่าพิมพ์ซ้ำได้ — สำหรับ scope restaurant การพิมพ์ซ้ำ 2 ใบไม่อันตราย

### Latency

- Webhook → server: < 500ms (sync)
- Job queued → ใบเสร็จออก: 0–5 วินาที (ขึ้นกับ polling interval ของ printer)
- cputil markup → bytes: < 100ms ปกติ (cold start ครั้งแรก ~500ms)

### Image fetching

ถ้า markup มี `[image: url https://...]` server จะ pre-fetch รูปก่อนส่งให้ cputil — ใช้เวลาเพิ่ม 100–500ms ขึ้นกับ size + network

---

## Star Document Markup

ระบบ render markup → StarPRNT command bytes ผ่าน Star CPUtil ดังนั้นรองรับ tag ตามสเปกของ Star เต็ม

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
| `[image: url URL; width N%; min-width Xmm]` | embed รูปจาก URL (server pre-fetch) |
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

## Example: Zoho Creator Workflow

ใน Zoho Creator → Form/Workflow → Action: **Send HTTP Request**

```
URL:     https://starprinter-hub.vercel.app/api/print/jobs
Method:  POST
Type:    JSON

Headers:
  x-api-key: <your-api-key>
  Content-Type: application/json

Body:
{
  "printerId":   "<printer-uuid-จากระบบ>",
  "referenceId": <%input.OrderID%>,
  "markup":      <%markup-builder-output%>
}
```

ทีม Zoho สร้าง markup ฝั่งตัวเองด้วย Deluge string concat แล้วส่งมาทั้ง string

---

## Future Endpoints (ยังไม่มีในเวอร์ชันนี้)

- `GET /api/jobs/:jobId` — query สถานะ
- `POST /api/jobs/:jobId/cancel` — ยกเลิกก่อนพิมพ์
- `GET /api/printers` — list printer + สถานะ

ตอนนี้ดูสถานะผ่าน Admin UI ของ Star Printer Hub
