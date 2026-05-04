# CloudPRNT Protocol — Study Notes

สรุปการศึกษาจากตัวอย่างทางการของ Star Micronics: `php_queue_v200/`

| รายการ | ข้อมูล |
|---|---|
| ที่มา | Star Micronics, php_queue Ver 2.0.0 (22/12/2023) |
| Path | `/Users/gobelmo/code/starprinter-hub/php_queue_v200/` |
| ขอบเขต | CloudPRNT HTTP + MQTT v2 |
| รุ่นที่รองรับ | mC-Print2/3, TSP100IV(SK), mC-Label3, TSP650/700/800II + IFBD-HI01X, SP700 + IFBD-HI02X |

---

## 1. ภาพรวมโครงสร้างไฟล์

```
php_queue/
├── cloudprnt.php          # ⭐ Endpoint หลักรับ POST/GET/DELETE จากเครื่องพิมพ์
├── cputil.php             # เรียก CPUtil binary แปลง Star Markup → printer format
├── print.php              # ฝั่ง user: trigger สั่งพิมพ์ใหม่
├── devices.php            # CRUD เครื่องพิมพ์
├── queues.php             # CRUD queue
├── management.html/.js    # Admin UI
├── print.html             # ปุ่มสั่งพิมพ์ทดสอบ
├── cloudprnt-setting.json # เครื่องพิมพ์ดึงไปรู้ capability ของ server
├── simplequeue.sqlite     # DB
└── mqtt_*.{php,sh,ps1}    # CloudPRNT v2 (MQTT) — push-based
```

---

## 2. HTTP Protocol — รายละเอียดจริง

### 2.1 Polling — POST `/cloudprnt.php`

**Request body (JSON) จากเครื่องพิมพ์:**

```json
{
  "printerMAC": "00:11:62:xx:xx:xx",
  "statusCode": "200%20OK",          // URL-encoded status
  "clientAction": [                   // (response เมื่อ server เคยถาม)
    { "request": "PageInfo",      "result": { "printWidth": 72, "horizontalResolution": 8 } },
    { "request": "ClientType",    "result": "TSP100IV" },
    { "request": "ClientVersion", "result": "1.2.3" }
  ]
}
```

จุดสำคัญ — **`printerMAC` คือ primary identifier** ทุกอย่างใน sample lookup ด้วย MAC (ไม่ใช่ printerId แบบ UUID อย่างที่เราออกแบบไว้)

**Response (JSON) จาก server:**

```json
{
  "jobReady": true,
  "mediaTypes": ["application/vnd.star.starprnt", "image/png", "text/plain"],
  "clientAction": [                           // server ขอ info จากเครื่องพิมพ์
    { "request": "PageInfo",      "options": "" },
    { "request": "ClientType",    "options": "" },
    { "request": "ClientVersion", "options": "" }
  ],
  "deleteMethod": "GET"                       // optional — แทน DELETE method
}
```

**Logic 3 ขา ที่ server ทำใน POST:**

1. ถ้า MAC ยังไม่ register → ไม่ทำอะไร (ปล่อย `jobReady=false`)
2. ถ้า body มี `clientAction` → printer ตอบกลับสิ่งที่ server เคยถาม → เก็บ width/type/version ลง DB
3. ปกติ:
   - ถ้ายังไม่รู้ width ของ printer → ขอผ่าน `clientAction: PageInfo + ClientType + ClientVersion`
   - ถ้ารู้แล้ว → check ว่ามีงานพิมพ์ค้างไหม → ตอบ `jobReady`

### 2.2 Fetch Job — GET `/cloudprnt.php?mac=XX&type=YY`

**Query string:**
- `mac` — printer MAC (identify queue)
- `type` — media type ที่ printer เลือกจาก `mediaTypes` ที่ server เสนอ

**Server flow:**
1. Lookup งานที่รอพิมพ์ของ printer ตัวนี้
2. ดึง template params (Header, Footer, Logo, Coupon) จาก DB
3. **เขียน Star Markup เป็น `.stm` file ใน `/tmp`**
4. **เรียก CPUtil binary** แปลงเป็น format ที่ printer ขอ
5. ส่งไฟล์กลับเป็น response body พร้อม `Content-Type` + `Content-Length`
6. ลบ temp files

**Star Markup ตัวอย่าง:**

```
[align: centre]
[image: url https://.../logo.png; width 100%]
Welcome to our shop
[align: centre][mag: w 4; h 4]A001[mag]
Thanks for visiting!
[image: url https://.../coupon.png; width 100%]
[cut]
```

### 2.3 Acknowledge — DELETE หรือ GET-with-delete

**สอง mode:**

A) **DELETE method** (default) — `DELETE /cloudprnt.php?mac=XX&code=200`

B) **GET-with-delete** (ถ้า server ตอบ `deleteMethod: "GET"` ตอน POST) — `GET /cloudprnt.php?mac=XX&code=200&delete`

**Code interpretation จาก sample:**

```php
$headercode = substr($_GET['code'], 0, 1);
if ($headercode != "2") {                  // ไม่ใช่ 2xx = ไม่สำเร็จ
    $fullcode = substr($_GET['code'], 0, 3);
    if ($fullcode === "520") {              // 520 = download timeout
        $clearJobFromDB = false;            // ไม่เคลียร์งาน รอ retry
    }
}
```

**สรุป:**
- `2xx` → พิมพ์สำเร็จ → mark done
- `5xx` (ทั่วไป) → error → mark failed (ไม่ retry — printer rejection)
- `520` → network timeout → คงสถานะไว้ ให้ retry
- `4xx` → request error → log แต่ clear

### 2.4 Status Codes ที่พบบ่อย

`statusCode` ใน body POST จะ url-encoded เช่น `"200%20OK"`, `"200%20Paper%20Near%20End"`, `"507%20Cover%20Open"` — ดู Star SDK สำหรับชุดเต็ม

---

## 3. CPUtil — Star Markup Conversion

### 3.1 มันคืออะไร

CPUtil คือ CLI binary ของ Star ที่แปลง Star Markup → format ที่ printer ขอ (ESC/POS variants, StarPRNT, image bitmap, ฯลฯ)

```bash
cputil thermal3 scale-to-fit dither decode \
       "application/vnd.star.starprnt" \
       input.stm \
       output.bin
```

Width preset ตามจริง:
| Width (dots) | Preset |
|---|---|
| ≤ 58×8 = 464 | `thermal2` |
| ≤ 72×8 = 576 | `thermal3` |
| ≤ 82×8 = 656 | `thermal82` |
| ≤ 112×8 = 896 | `thermal4` |

### 3.2 ปัญหาบน Vercel (Serverless)

❌ **CPUtil เป็น native binary → ใช้ตรง ๆ บน Vercel ไม่ได้** เพราะ
- Vercel functions ไม่ allow arbitrary subprocess
- File system เป็น read-only ยกเว้น `/tmp`
- Cold start จะช้าถ้าต้องโหลด binary
- License — ไม่ชัดว่า redistribute ผ่าน Vercel image ได้หรือไม่

### 3.3 ทางเลือกสำหรับ Vercel

| ทางเลือก | ข้อดี | ข้อเสีย |
|---|---|---|
| **A) `text/plain` only** | ง่าย, ใช้ได้ทันที | ไม่มี logo, alignment, cut, lineupdate |
| **B) สร้าง `application/vnd.star.starprnt` raw command ตรง ๆ** | ใช้ฟีเจอร์เต็ม, no binary | ต้องเขียน builder เอง (escape, byte sequences) |
| **C) JS port ของ CPUtil (ถ้ามี)** | เหมือน official | ยังไม่พบ implementation ที่ดี |
| **D) Run CPUtil on separate VM/container** เป็น sidecar service | Vercel เรียกผ่าน HTTP | เพิ่ม infra + ค่าใช้จ่าย |
| **E) `image/png` rendering** — render receipt เป็นภาพ ส่งให้ printer | ใช้ฟีเจอร์ HTML/CSS เต็ม | Performance + ขนาด, ต้องใช้ headless browser/canvas |

**แนะนำ:** เริ่มที่ **(B) StarPRNT raw command** — มี npm package เช่น `node-thermal-printer`, `star-prnt-encoder` ที่ทำ command builder ให้แล้ว ตอบโจทย์ใบเสร็จ + cut + bold + barcode + QR ได้ครบ

---

## 4. Device Capability Discovery (`clientAction`)

ฟีเจอร์ที่เรา **ยังไม่ได้ออกแบบ** ใน Implementation Plan แต่ official sample ใช้

**Workflow:**
1. Printer ใหม่ POST poll ครั้งแรก (server ไม่รู้ width)
2. Server ตอบ `{ jobReady: false, clientAction: [PageInfo, ClientType, ClientVersion] }`
3. Printer poll ครั้งถัดไป (5–10 วิ ต่อมา) แนบ `clientAction` ผลลัพธ์ใน body
4. Server บันทึก `dot_width`, `client_type`, `client_version` ลง DB
5. ครั้งต่อไปถ้ามีงาน → ส่ง content ที่ render ตาม width ที่รู้

**ผลกระทบต่อ schema:** ตาราง `printers` ของเราต้องเพิ่ม:
- `dot_width` (int) — เช่น 576 dots สำหรับ 72mm@8dpmm
- `client_type` (text) — เช่น "TSP100IV"
- `client_version` (text) — firmware version
- `last_status_code` (text) — เก็บ statusCode ล่าสุด เช่น "200 OK", "507 Cover Open"

---

## 5. MQTT Protocol — CloudPRNT v2

โหมดใหม่ใน v2.0.0 (Dec 2023) สำหรับเครื่องพิมพ์ที่รองรับ — **push-based** แทน polling

### 5.1 ข้อดีหลัก

- **No polling** → ลด invocation cost บน Vercel มหาศาล
- Latency ต่ำ (วินาทีแรกหลัง publish)
- รู้ status เครื่องพิมพ์ทันทีเมื่อเปลี่ยน

### 5.2 Topic structure

```
star/cloudprnt/to-device/{MAC}/{method}    # Server → Printer
star/cloudprnt/from-device/{MAC}/{method}  # Printer → Server
```

**Methods (Server → Printer):**
- `request-post` — บอก printer ให้ POST มา HTTP server (Trigger POST mode)
- `request-client-status` — ขอสถานะ
- `order-client-action` — ขอ PageInfo / ClientType / ClientVersion
- `print-job` — ส่งงานพิมพ์โดยตรง (raw หรือ url)

**Methods (Printer → Server):**
- `client-status` — ส่งสถานะ + ผล clientAction
- `print-result` — แจ้งผลพิมพ์ (statusCode)

### 5.3 Sub-modes ของ MQTT

| Mode | Flow | Use case |
|---|---|---|
| **Trigger POST** | MQTT บอก printer → printer ทำ HTTP POST ปกติ | Hybrid: ใช้ logic HTTP เดิม + ลด polling |
| **Pass URL** | MQTT message มี `printData: <URL>` → printer fetch ผ่าน HTTP | ใช้เมื่อ payload ใหญ่ |
| **Full MQTT** | MQTT message มี `printData` เป็น content เต็ม | ตัดขาดจาก HTTP server |

### 5.4 ข้อจำกัดบน Vercel

❌ Vercel **ไม่มี native MQTT broker** — ต้องใช้:
- External broker (HiveMQ Cloud free, EMQX, Mosquitto on VPS)
- หรือ MQTT-over-WebSocket ผ่าน Vercel Edge — ต้องมี process ค้าง (ไม่เหมาะกับ serverless)

**สรุป:** สำหรับ Vercel — เริ่มที่ **HTTP polling** ก่อน ถ้าต้องการลด cost ค่อยเพิ่ม Trigger POST mode (ใช้ external MQTT broker ราคาถูก)

---

## 6. Server Settings Endpoint

เครื่องพิมพ์ Star **fetch `cloudprnt-setting.json`** จาก server ตอน setup เพื่อรู้ว่า server รองรับ protocol อะไรบ้าง

```json
{
  "title": "star_cloudprnt_server_setting",
  "version": "1.0.0",
  "serverSupportProtocol": ["HTTP"],
  "settingForMQTT": {
    "useTriggerPOST": false,
    "mqttConnectionSetting": {
      "hostName": "broker.example.com",
      "portNumber": 1883,
      "useTls": false,
      "authenticationSetting": { "username": "...", "password": "..." }
    }
  }
}
```

**ผลกระทบ:** เราต้อง expose endpoint `/cloudprnt-setting.json` ตอบ JSON นี้ — ถ้า HTTP-only ตอบ minimum:

```json
{
  "title": "star_cloudprnt_server_setting",
  "version": "1.0.0",
  "serverSupportProtocol": ["HTTP"]
}
```

---

## 7. Schema เปรียบเทียบ — Sample vs ของเรา

### 7.1 Devices (Sample) vs Printers (เรา)

| Sample field | ของเรา | หมายเหตุ |
|---|---|---|
| `DeviceMac` (PK) | `macAddress` (unique) | Sample ใช้เป็น key หลัก |
| `Status` | ❌ ไม่มี | ต้องเพิ่ม `last_status_code` |
| `QueueID` | ❌ ไม่มี | เราใช้ `branchCode` + `jobPrefix` แทน |
| `Printing` (int = position) | `print_jobs.status` | เรา normalize กว่า |
| `ClientType` | ❌ ไม่มี | ต้องเพิ่ม |
| `ClientVersion` | ❌ ไม่มี | ต้องเพิ่ม |
| `LastPoll` (unix ts) | `lastSeenAt` | ✓ |
| `DotWidth` | ❌ ไม่มี | ต้องเพิ่ม |

### 7.2 Queues (Sample) vs Templates (เรา)

Sample เก็บ design เป็น field ใน DB (`Header`, `Footer`, `Logo`, `Coupon`) ให้แก้ผ่าน UI ได้
ของเราเก็บ template ใน source code (TypeScript function)

**Trade-off:**
- DB-stored → ลูกค้าแก้เองได้ ไม่ต้อง deploy
- Code-stored → type-safe, review ผ่าน PR, ทดสอบได้

**แนะนำ:** Hybrid — template "structure" (layout) อยู่ใน code; "data" (logo URL, header text, footer text) อยู่ DB ให้ admin แก้ได้ แต่ไม่เปลี่ยน layout

---

## 8. ช่องว่างที่ต้องเติมใน Implementation Plan

ตารางสรุปจุดที่ Plan ของเรา **ยังขาด** หรือ **ต้องปรับ**

| # | ประเด็น | สถานะ Plan เดิม | ต้องทำ |
|---|---|---|---|
| 1 | ใช้ `printerMAC` เป็น identifier ใน CloudPRNT body แทน path param `printerId` | path = UUID | เปลี่ยนเป็น query/body MAC + lookup MAC → UUID |
| 2 | `clientAction` flow (ถาม-ตอบ capability) | ❌ ไม่มี | เพิ่ม logic ครบ + เก็บ width/type/version |
| 3 | `dot_width`, `client_type`, `client_version`, `last_status_code` ใน schema | ❌ ไม่มี | เพิ่ม column |
| 4 | Parse + เก็บ `statusCode` จากทุก poll | ❌ ไม่มี | บันทึก paper out / cover open / error |
| 5 | DELETE-with-GET fallback (`deleteMethod: "GET"`) | ❌ ไม่มี | รองรับทั้ง 2 paths |
| 6 | Code 520 = ไม่เคลียร์งาน (retry) | ❌ ไม่ระบุ | implement logic |
| 7 | Endpoint `/cloudprnt-setting.json` | ❌ ไม่มี | เพิ่ม static endpoint |
| 8 | Star Markup vs StarPRNT raw vs text/plain | ระบุ "text/plain default" หลวม ๆ | เลือก path ชัด → แนะนำ **StarPRNT raw ผ่าน npm builder** |
| 9 | CPUtil alternative | ❌ ไม่ระบุ | document trade-off + เลือก path |
| 10 | MQTT mode | ระบุว่าไม่รองรับ | คงไว้เป็น future enhancement (Phase 2 product roadmap) |
| 11 | Template = DB-stored design fields | code-only | revisit hybrid model |
| 12 | Width-aware rendering | ❌ ไม่มี | template รับ `dotWidth` เป็น input |

---

## 9. Decisions ที่ต้อง revisit ก่อนเริ่ม Phase 1

1. **Output format**: ตกลงไปกับ **StarPRNT raw command** (`application/vnd.star.starprnt`) ใช้ npm `star-prnt-encoder` หรือใกล้เคียง — ได้ logo / cut / barcode / QR / alignment ครบ
2. **Identifier**: path เปลี่ยนเป็น `/api/cloudprnt/[mac]` (URL-safe MAC) หรือ `/api/cloudprnt` แล้วอ่าน MAC จาก body — เลือกแบบหลัง (ปลอดภัยกว่า + ตรงกับ official)
3. **Schema เพิ่ม**: ตาราง `printers` เพิ่ม column ตามข้อ 7.1; เพิ่มตาราง `printer_status_log` เก็บ history `statusCode` ก็ดี (optional)
4. **Capability discovery**: ทำเป็น state machine — printer สถานะ `unknown` → `discovering` → `ready`; ระหว่าง `discovering` server ส่ง `clientAction`
5. **Retry policy**: Code 520 → คืน `pending`; Code 4xx/5xx อื่น → `failed` (ไม่ retry); cron retry-stuck-jobs ของเรา (จาก plan เดิม) ยัง valid
6. **Server settings endpoint**: static route `/api/cloudprnt-setting.json` — content คงที่ (HTTP only) ไม่ต้องอ่าน DB
7. **MQTT**: ไม่ทำใน Phase 1 — ใส่ใน "Future Roadmap" ของ SoW ถ้าลูกค้าสนใจค่อยเสนอ Phase 2

---

## 10. ตัวอย่าง CloudPRNT Reference Flow ที่อัปเดตแล้ว

```
┌──────────────┐                                    ┌─────────────────────┐
│ Star Printer │                                    │  Vercel (Next.js)   │
│  MAC: 00:11  │                                    │                     │
└──────┬───────┘                                    └──────┬──────────────┘
       │                                                   │
       │ (1) Setup: GET /api/cloudprnt-setting.json        │
       │ ─────────────────────────────────────────────────►│
       │ ◄──── { serverSupportProtocol: ["HTTP"] }         │
       │                                                   │
       │ (2) POST /api/cloudprnt                           │
       │     { printerMAC: "00:11", statusCode: "200%20OK"}│
       │ ─────────────────────────────────────────────────►│
       │                                                   │ ── Server ยังไม่รู้ width
       │ ◄──── { jobReady: false,                          │
       │        clientAction: [PageInfo,                   │
       │                       ClientType,                 │
       │                       ClientVersion] }            │
       │                                                   │
       │ (3) POST (5s ต่อมา) + clientAction result         │
       │ ─────────────────────────────────────────────────►│
       │                                                   │ ── Save dot_width=576, type, ver
       │ ◄──── { jobReady: false }                         │
       │                                                   │
       │   ... user ใน Zoho ส่ง webhook → enqueue ...      │
       │                                                   │
       │ (4) POST                                          │
       │ ─────────────────────────────────────────────────►│
       │                                                   │ ── พบงาน pending
       │ ◄──── { jobReady: true,                           │
       │        mediaTypes: [                              │
       │          "application/vnd.star.starprnt",         │
       │          "text/plain"] }                          │
       │                                                   │
       │ (5) GET /api/cloudprnt?mac=00:11&type=...starprnt │
       │ ─────────────────────────────────────────────────►│
       │                                                   │ ── Atomic claim + render
       │ ◄──── <binary StarPRNT command stream>            │
       │                                                   │
       │ (6) เครื่องพิมพ์พิมพ์ออกมา                          │
       │                                                   │
       │ (7) DELETE /api/cloudprnt?mac=00:11&code=200      │
       │ ─────────────────────────────────────────────────►│
       │                                                   │ ── Mark done
       │ ◄──── 204                                         │
       │                                                   │
```

---

## 11. Reference Links

- Star CloudPRNT SDK Manual: https://www.star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/index.html
- Protocol Reference: `protocol-reference/index.html`
- Status Codes: `protocol-reference/common-spec-reference/printer-status-code/index.html`
- Media Types: `protocol-reference/common-spec-reference/content-mediatypes/index.html`
- POST Polling (request/response): `protocol-reference/http-method-reference/server-polling-post/`
- npm `star-prnt-encoder`: tool builder StarPRNT command (ทางเลือกแทน CPUtil)
- npm `node-thermal-printer`: high-level API — รองรับ Star SBCS

---

## 12. Updates from Official Manual (Authoritative)

ส่วนนี้รวบรวมข้อมูลจากเอกสารทางการ Star CloudPRNT — **มีลำดับชั้นเหนือกว่าข้อ 1–10** (ที่มาจากการอ่าน PHP sample) เมื่อขัดแย้งกัน

### 12.1 POST Request Body (จาก printer) — ครบทุก field

| Field | Type | Required | คำอธิบาย |
|---|---|---|---|
| `statusCode` | string | **✓ Required** | 3-4 หลัก + คำอธิบาย URL-encoded เช่น `"200%20OK"`, `"220%20Printing%20In%20Progress"`, `"507%20Cover%20Open"` |
| `printerMAC` | string | optional | Ethernet MAC (เป็น Ethernet เสมอ แม้ใช้ wireless) เช่น `"00:11:e5:06:04:ff"` |
| `uniqueID` | string | optional | ID ที่ server เคย assign ให้ (`"Star1"`) — รวมเฉพาะถ้า server เคยส่งให้ |
| `jobToken` | string | optional | แนบมาเฉพาะระหว่างที่มี job in progress — หายเมื่อ DELETE สำเร็จ |
| `printingInProgress` | boolean | optional | `true` ระหว่างพิมพ์ — ใช้ดู missed DELETE บน network ไม่เสถียร |
| `clientAction` | array | optional | response ต่อ server-requested action (PageInfo / ClientType / ClientVersion) |
| `status` | string | optional | Star ASB hex format เช่น `"23 6 0 0 0 0 0 0 0"` |
| `barcodeReader` | array | optional | ถ้ามีอุปกรณ์ต่อ (ไม่เกี่ยวกับ scope ใบเสร็จ) |
| `keyboard` | array | optional | ถ้ามีอุปกรณ์ต่อ |
| `display` | array | optional | line display ที่ต่ออยู่ |

> **สำคัญ:** `printerMAC` เป็น **optional** — บางกรณี printer อาจไม่ส่ง — ต้องเตรียม fallback (ใช้ uniqueID หรือ MAC จาก URL/headers)

### 12.2 POST Response Body (จาก server) — ครบทุก field

| Field | Type | Required | คำอธิบาย |
|---|---|---|---|
| `jobReady` | boolean | **✓ Required** | true = มีงาน, false = ว่าง |
| `mediaTypes` | array | optional* | required เมื่อ `jobReady=true` — รายชื่อ MIME ที่ server ทำได้ |
| `jobToken` | string | optional | UUID/hash ผูก GET/DELETE กับ job เฉพาะตัว |
| `deleteMethod` | string | optional | `"DELETE"` (default) หรือ `"GET"` — ใช้ "GET" เผื่อ printer firmware เก่า |
| `clientAction` | array | optional | ขอข้อมูล printer (PageInfo, ClientType, ClientVersion) |
| `claimBarcodeReader` | array/bool | optional | ขอ control บาร์โค้ด (reset ทุก poll) |
| `claimKeyboard` | array/bool | optional | ขอ control keyboard |
| `display` | string/array | optional | ส่งข้อความขึ้น line display |
| `jobGetUrl` | string | optional | **ใช้ redirect** — printer ไป GET content จาก URL อื่น |
| `jobConfirmationUrl` | string | optional | redirect DELETE ไป URL อื่น |

> **Constraint สำคัญจาก manual:** ถ้า `jobReady=true` พร้อมกับ `clientAction` request — printer จะประมวลผล `clientAction` ก่อน แล้วค่อยพิมพ์ใน poll ครั้งถัดไป

### 12.3 ตาราง Status Codes ครบ

#### 2xx — Online / Normal
| Code | คำอธิบาย |
|---|---|
| 200 | OK (online, พร้อมพิมพ์) |
| 201 | Output paper taken |
| 211 | Paper low |
| 220 | Printing in progress |
| 221 | Output paper present |
| 230 | Cleaning notification |
| 231 | Parts replacement notification |

#### 4xx — Hardware Error
| Code | คำอธิบาย |
|---|---|
| 410 | Out of paper |
| 411 | Paper jam |
| 412 | Roll position error |
| 420 | Cover open |

#### 5xx — Job Processing Error
| Code | คำอธิบาย |
|---|---|
| 510 | Incompatible media type (printer ไม่รองรับ) |
| 511 | Media decoding error (decode ไฟล์ไม่ได้ — JSON ผิด) |
| 512 | Unsupported media version |
| 520 | Download timeout (network) — **server ไม่ควรเคลียร์งาน** |
| 521 | Job too large for buffer |

#### 1xxx — Server Response Error (printer แจ้งกลับว่า server ตอบผิด)
| Code | คำอธิบาย |
|---|---|
| 1000 | JSON format error |
| 1001 | Missing/invalid required key |
| 1100 | Undefined MQTT method topic |
| 1101 | MQTT payload JSON format error |
| 1102 | Missing/invalid required key in MQTT payload |
| 1200 | Cannot print — printer currently busy |
| 1201 | jobToken not specified |
| 1202 | jobToken value already recently used |

### 12.4 Media Types ที่รองรับ (จาก manual)

#### Standard
- `text/plain` — universal, ภาษาไทย UTF-8 ใช้ได้บน TSP100IV ขึ้นไป
- `image/png` — universal
- `image/jpeg` — เฉพาะ mC-Label3
- `application/octet-stream` — **deprecated** ห้ามใช้

#### Star-specific
- `application/vnd.star.starprnt` — StarPRNT mode (mC-Print2/3 v3.5+, TSP100IV, mC-Label3)
- `application/vnd.star.starprntcore` — universal Star format ✨ **แนะนำถ้าต้องการ raw command** (ทำงานข้าม emulation mode)
- `application/vnd.star.line` — line mode commands
- `application/vnd.star.linematrix` — line mode สำหรับ matrix printer (HI02X)
- `application/vnd.star.raster` — raster
- `image/vnd.star.png` — Star PNG พร้อม parameters
- `application/vnd.star.starconfiguration` — เปลี่ยน config printer

#### Device support summary (สำหรับเลือก format ทำงานข้ามรุ่น)
| Printer | Supported |
|---|---|
| mC-Print2/3 (v3.5+), TSP100IV(SK), mC-Label3 | text/plain, image/png, image/jpeg (Label3), vnd.star.* ทุกแบบ |
| HI01X interface (TSP650/700/800II + IFBD-HI01X) | text/plain, image/png, image/jpeg, vnd.star.line, vnd.star.raster, vnd.star.starprntcore |
| HI02X interface (SP700 + IFBD-HI02X) | text/plain, image/png, image/jpeg, vnd.star.linematrix |

### 12.5 Idempotency — กฎสำคัญที่ขาดไม่ได้

จาก manual:

> "GET should have no server side effects; simply re-sending the same GET should result in re-downloading the same job until the server state is changed by a POST or DELETE."

**ผลกับ implementation:**
- POST = อัปเดต state (last_seen, status code) + return jobReady (อาจมี side effect: claim job, set jobToken)
- GET = ห้ามเปลี่ยน state — ต้อง return content เดิมทุกครั้งจนกว่า DELETE จะมา
- DELETE = state transition สุดท้าย

**Implementation pattern ที่ถูก:**
1. POST ครั้งแรก: peek pending → return `jobReady=true, jobToken=X` (ยังไม่ claim)
2. GET ครั้งแรก: claim pending → printing, return content, *เก็บ token X*
3. GET ครั้งที่สอง (retry): หา job status='printing' with token X → return content เดิม (idempotent ✓)
4. DELETE ครั้งแรก: mark done/failed
5. DELETE ครั้งที่สอง (retry): no-op

### 12.6 Missed DELETE Detection

`printingInProgress` field ใน POST body = ตัวบอกว่ามี DELETE ที่หายไป (printer ยังคิดว่ากำลังพิมพ์อยู่ แต่ server ไม่เคยรับ DELETE)

**Use case:** ถ้า server เห็น `printingInProgress=true` แต่ใน DB ไม่มี job `printing` แล้ว → DELETE หาย → ต้อง resolve อย่างไรอย่างหนึ่ง (mark done? log warning?)

ใน scope simple ของเรา ไม่ critical — cron expire-stuck ก็ครอบคลุม edge case นี้ได้

### 12.7 จุดที่ Section 1–10 ของเอกสารนี้ผิด/ไม่ครบ

ระบุไว้เพื่อ traceability — เอกสารส่วนต้นเขียนจาก inferred info ของ PHP sample

| # | จุด | ถูกต้องตามแมนนวล |
|---|---|---|
| 2.1 | บอกว่า `printerMAC` คือ primary identifier | จริง ๆ optional + ควรใช้ร่วมกับ uniqueID หรือ URL path |
| 2.1 | ไม่ได้พูดถึง `jobToken`, `printingInProgress` | เป็น field สำคัญที่ขาดไป |
| 2.4 | ระบุไม่ครบทุก code | ดูตาราง 12.3 |
| 3 | บอกว่า StarPRNT raw แนะนำ | จริง ๆ `vnd.star.starprntcore` ดีกว่า (universal) |
| 8 | เก็บ `dot_width` ใน schema | ไม่จำเป็น สำหรับ text/plain (printer ตัดบรรทัดเอง) |
