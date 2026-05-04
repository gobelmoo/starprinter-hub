# PoC: ระบบสั่งพิมพ์ใบเสร็จด้วย Star CloudPRNT (PHP)

## 1. วัตถุประสงค์

สาธิตการสั่งพิมพ์ใบเสร็จ (เช่น ใบเก็บค่าเช่าอพาร์ตเมนต์) ออกทาง **เครื่องพิมพ์ Star ที่รองรับ CloudPRNT** โดยใช้เพียง PHP บนฝั่งเซิร์ฟเวอร์ ไม่ต้องลงไดรเวอร์ ไม่ต้องเชื่อมต่อ USB และไม่ต้องเปิดพอร์ตจาก client ออกอินเทอร์เน็ต

แนวคิดหลัก: เครื่องพิมพ์เป็นฝ่าย **เรียกหา** เซิร์ฟเวอร์เอง (poll-based) เซิร์ฟเวอร์เพียงรอและเตรียมงานพิมพ์ไว้ให้

## 2. Star CloudPRNT คืออะไร

CloudPRNT คือ protocol ของ Star Micronics ที่ทำให้เครื่องพิมพ์รุ่นใหม่ (เช่น TSP100IV, mC-Print, mPOP) ทำงานเป็น HTTP client โดยตรง ลำดับการทำงานคือ

```
┌──────────────┐                       ┌──────────────┐
│ Star Printer │                       │  PHP Server  │
└──────┬───────┘                       └──────┬───────┘
       │  (1) POST /print.php (ทุก N วินาที)  │
       │ ─────────────────────────────────────►│
       │                                       │
       │  (2) 200 OK  {jobReady, mediaTypes}   │
       │ ◄─────────────────────────────────────│
       │                                       │
       │  ถ้า jobReady = true:                  │
       │  (3) GET /print.php                   │
       │ ─────────────────────────────────────►│
       │                                       │
       │  (4) 200 OK  text/plain  <ใบเสร็จ>     │
       │ ◄─────────────────────────────────────│
       │                                       │
       │  (5) เครื่องพิมพ์พิมพ์ออกมา               │
       │                                       │
```

จุดเด่น

- เครื่องพิมพ์ออก **outbound HTTP** เท่านั้น → ติดตั้งที่ไหนก็ได้ที่มีเน็ต ไม่ต้อง forward port
- เซิร์ฟเวอร์ไม่ต้องรู้ IP ของเครื่องพิมพ์
- ใช้ HTTP ธรรมดา → debug ง่าย, mock ได้, scale ง่าย

## 3. โครงสร้างของ PoC

```
php-poc/
├── receipt_form.php   # หน้าฟอร์มกรอกข้อมูลใบเสร็จ
├── trigger.php        # รับ POST จากฟอร์ม → เก็บข้อมูล + ตั้งธงว่ามีงานพิมพ์
├── print.php          # CloudPRNT endpoint (POST = ตอบสถานะ, GET = ส่งเนื้อหา)
└── starprint.php      # สคริปต์จำลองเครื่องพิมพ์สำหรับทดสอบโดยไม่มีเครื่องจริง
```

ระหว่างทำงานจะมีไฟล์ชั่วคราว 2 ไฟล์เกิดขึ้น (และถูกลบทิ้งหลังพิมพ์)

| ไฟล์ | บทบาท |
|---|---|
| `receipt.json` | ข้อมูลใบเสร็จ (tenant, room, rent, water, electric) |
| `print.txt` | ธง (flag) ว่ามีงานพิมพ์รออยู่ — มีอยู่ = `jobReady: true` |

> หมายเหตุ: PoC นี้เก็บ state เป็นไฟล์เพื่อความเรียบง่าย ในระบบจริงควรใช้ DB / queue (เช่น Redis, MySQL) เพื่อรองรับหลายงาน หลายเครื่องพิมพ์ และ concurrency

## 4. รายละเอียดแต่ละไฟล์

### 4.1 `receipt_form.php`

หน้า HTML ฟอร์มเรียบ ๆ ให้ผู้ใช้กรอก: ชื่อผู้เช่า, ห้อง, ค่าเช่า, ค่าน้ำ, ค่าไฟ
เมื่อกด Submit จะส่ง POST ไป `trigger.php`

### 4.2 `trigger.php`

หลักการ

1. รับข้อมูลจาก `$_POST`
2. เซฟเป็น `receipt.json` (UTF-8, รองรับภาษาไทย)
3. สร้างไฟล์ `print.txt` เป็นธงบอกว่า "มีงานพิมพ์รอ"
4. แสดงหน้ายืนยัน (success/error) ให้ผู้ใช้

เท่านี้ก็จบหน้าที่ — งานที่เหลือเครื่องพิมพ์จะเป็นฝ่ายมาเอาเอง

### 4.3 `print.php` (หัวใจของ PoC)

endpoint เดียว แต่ทำงานต่างกันตาม HTTP method

**POST request** — เครื่องพิมพ์ poll มาถามสถานะ

```php
echo json_encode([
    "jobReady"   => file_exists($printFile),
    "mediaTypes" => ["text/plain"]
]);
```

ตอบ `jobReady = true` ถ้ามีไฟล์ `print.txt` (= มีงานรอ) และบอกว่ารองรับ `text/plain`

**GET request** — เครื่องพิมพ์มาดึงเนื้อหา

```php
header('Content-Type: text/plain');
// อ่าน receipt.json → จัดรูปเป็นข้อความ → echo
// ลบ receipt.json และ print.txt (ack/cleanup)
```

> **ข้อสำคัญ:** การลบไฟล์หลัง GET = การ acknowledge ว่างานถูกส่งให้เครื่องพิมพ์แล้ว ครั้งต่อไปที่เครื่องพิมพ์ poll มา จะได้ `jobReady: false`
> ในระบบจริงควรลบ **หลังจาก** เครื่องพิมพ์ส่ง DELETE หรือ confirm กลับมา (CloudPRNT v2 มี mechanism นี้) เพื่อกัน edge case ที่ network หลุดระหว่าง GET

### 4.4 `starprint.php` (ตัวจำลองเครื่องพิมพ์)

สคริปต์ CLI ที่ทำหน้าที่เหมือนเครื่องพิมพ์ — POST ทุก 3 วินาที, ถ้าเจองานก็ GET แล้วพิมพ์ลงหน้าจอ ใช้สำหรับทดสอบ flow โดยไม่ต้องมีเครื่องจริง

```
php starprint.php [endpoint_url]
```

ค่า default endpoint = `http://localhost:8000/print.php`

## 5. วิธีรัน PoC

### Terminal 1 — รันเซิร์ฟเวอร์ PHP

```bash
cd /Users/gobelmo/code/starprinter-hub/php-poc
php -S 0.0.0.0:8000
```

### Terminal 2 — รันตัวจำลองเครื่องพิมพ์

```bash
cd /Users/gobelmo/code/starprinter-hub/php-poc
php starprint.php
```

จะเห็น output เป็นจุด `....` (poll แล้วยังไม่มีงาน)

### Browser — กรอกฟอร์ม

เปิด http://localhost:8000/receipt_form.php

กรอกข้อมูล → กด Submit → ภายใน 3 วินาที Terminal 2 จะแสดงใบเสร็จออกมา เช่น

```
----- BEGIN PRINT -----
APARTMENT RECEIPT
----------------------------
Room : 101
Tenant : สมชาย
----------------------------
Rent : 5000
Water : 200
Electric : 450
----------------------------
TOTAL : 5650
----------------------------
Date : 2026-05-04 16:20

------ END PRINT ------
```

## 6. การเชื่อมต่อกับเครื่องพิมพ์ Star จริง

1. เปิด `Star Printer Configuration` (ผ่านหน้าเว็บของเครื่องพิมพ์ หรือ IP บน LAN)
2. ตั้งค่า **CloudPRNT**
   - **Server URL** = `http://<server-host>:8000/print.php`
   - **Polling Interval** = 5–10 วินาที
3. Save & Reboot เครื่องพิมพ์
4. เครื่องพิมพ์จะเริ่ม poll มาที่ endpoint นี้ทันที — ทดสอบโดยกรอกฟอร์มในเบราว์เซอร์

> เครื่องพิมพ์ต้องเข้าถึงโฮสต์ของเซิร์ฟเวอร์ได้ ถ้าทดสอบในเครื่องเดียวกัน LAN ใช้ IP ของเครื่อง dev (เช่น `http://192.168.1.50:8000/print.php`) ไม่ใช่ `localhost`

## 7. ข้อจำกัดของ PoC นี้

PoC นี้ออกแบบให้สั้น เข้าใจง่าย จึง **ยังไม่เหมาะใช้ production** ด้วยข้อจำกัดดังนี้

- รองรับ **คิวเดียว, เครื่องพิมพ์เดียว** — ใช้ไฟล์ `print.txt` เป็น flag ตัวเดียว ถ้ามีหลายงานเข้ามาพร้อมกันจะเขียนทับ
- **ไม่มีการระบุตัวตนเครื่องพิมพ์** — ไม่ตรวจ MAC address หรือ token จาก request
- **ไม่มี authentication** ที่ฟอร์ม/endpoint — ใครก็ยิงสั่งพิมพ์ได้
- **ไม่ retry** ถ้า GET ล้มเหลวกลางทาง ข้อมูลก็หายไปเลย (เพราะลบทิ้งใน GET เดียว)
- **plain text เท่านั้น** — ยังไม่ได้ใช้ StarPRNT raw command ทำให้ไม่สามารถสั่ง bold, ตัดกระดาษ, เปิดลิ้นชัก, พิมพ์ logo ฯลฯ

## 8. แนวทางต่อยอด

| หัวข้อ | แนวทาง |
|---|---|
| คิวงาน | ย้ายจากไฟล์ → DB (เช่น MySQL/Postgres) มีตาราง `print_jobs` พร้อม status (`pending`, `printing`, `done`, `failed`) |
| หลายเครื่องพิมพ์ | ระบุ printer ด้วย MAC address ที่ส่งมาใน POST → จับคู่งานกับเครื่องที่ถูกต้อง |
| Acknowledge | รองรับ DELETE method (CloudPRNT v2) ลบงานเมื่อเครื่องพิมพ์ confirm สำเร็จเท่านั้น |
| รูปแบบใบเสร็จ | ส่ง `application/vnd.star.starprnt` (raw command) เพื่อใช้ฟีเจอร์เต็มของเครื่องพิมพ์ — bold, QR code, ตัดกระดาษ, เปิดลิ้นชัก |
| Authentication | เพิ่ม API key/token ทั้งฟอร์มและ endpoint, log ทุก job |
| Monitoring | log สถานะเครื่องพิมพ์ที่ส่งมาใน POST (`statusCode`, `status`) เพื่อดู paper out, cover open ได้ |

## 9. สรุป

PoC นี้พิสูจน์ได้ว่า

1. การสั่งพิมพ์ผ่าน Star CloudPRNT ใช้ PHP เพียงไฟล์เดียว (`print.php`) ก็ทำได้
2. ฝั่งผู้ใช้ (ฟอร์ม) แยกจากฝั่งเครื่องพิมพ์ (poll endpoint) อย่างสะอาด — สื่อสารผ่าน state file/DB เท่านั้น
3. สามารถทดสอบทั้ง flow ได้บนเครื่อง dev โดยไม่ต้องมีเครื่องพิมพ์จริง (ผ่าน `starprint.php`)

เป็นรากฐานที่ดีสำหรับขยายไปเป็นระบบสั่งพิมพ์ใบเสร็จเต็มรูปแบบในขั้นต่อไป
