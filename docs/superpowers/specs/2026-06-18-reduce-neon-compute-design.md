# ลด Neon compute usage (Tier 1) — Design

วันที่: 2026-06-18
สถานะ: approved (รอ review ก่อนทำ implementation plan)

## โจทย์และการ reframe

คำขอเดิม: "ลดการใช้งาน database เนื่องจาก neon monthly limit โดยไม่เก็บประวัติการพิมพ์"

**ข้อค้นพบสำคัญ:** limit ที่ชนจริงคือ **Neon Free compute hours (~191.9 hr/mo)** ไม่ใช่ storage
(ยืนยันจาก Neon console: "monthly compute allowance")

ดังนั้น "ไม่เก็บประวัติการพิมพ์" **ลดได้แค่ storage แทบไม่ช่วย compute** เพราะ:
- row ที่ done/failed ค้าง 15 วัน = กิน storage อย่างเดียว ไม่ปลุก compute
- retention cron = ปลุกวันละ 1 ครั้ง น้อยมาก
- หน้า history บน dashboard = admin เปิดเอง นานๆ ครั้ง

compute hours ถูกเผาจาก **จำนวนครั้งที่แตะ Postgres** ทุกครั้งปลุก compute ให้ตื่น
และเนื่องจาก Neon มี **auto-suspend floor 5 นาที** การแตะ 1 ครั้งทำให้ compute ตื่นอย่างน้อย 5 นาที

ตัวที่แตะ Postgres เป็นจังหวะแม้ตอน idle (จากการอ่านโค้ดปัจจุบัน):
1. `hasPendingJobCached` TTL = 5 นาที (`web/lib/cache/printer.ts:58`) — พอดีเป๊ะกับ auto-suspend
   window 5 นาที → ทุก 5 นาทีมี read ไปปลุก compute พอดีตอนกำลังจะหลับ → compute แทบไม่ได้หลับ
2. `last_seen` write debounce = 10 นาที **ต่อ warm instance** (`web/lib/cache/last-seen.ts`) —
   debounce แบบ in-memory ต่อ instance (ไม่ shared) ถ้ามีหลาย warm instance ยิ่งถี่ และ write แต่ละครั้ง
   reset auto-suspend timer

**ปัญหาที่แท้จริง:** ไม่ใช่แค่ "แตะ DB บ่อย" แต่คือ **แตะแบบสลับจังหวะ (staggered)** บวก floor 5 นาที →
ถ้า read กับ write เกิดคนละเวลา compute จะถูกสะกิดเรื่อยๆ จนไม่หลับ

## แนวทางที่เลือก: Phased (เริ่ม Tier 1, เก็บ Tier 2 เป็น fallback)

ผู้ใช้เลือก phased: ทำ Tier 1 (no new infra) ก่อน → วัดผล → escalate Tier 2 เฉพาะเมื่อยังไม่พอ

## หลักการ Tier 1: รวมจังหวะแตะ DB ให้เป็น heartbeat เดียว

ทำให้การแตะ Postgres ตอน idle **ทั้งหมดเกิดพร้อมกันเป็นจังหวะเดียว (heartbeat) แล้วเว้นยาวๆ**
เพื่อให้ compute ตื่นครั้งเดียวต่อรอบแล้วหลับยาว ใช้ **Vercel Data Cache** (shared ทุก instance,
ฟรี ไม่กิน Neon) เป็นตัวคุมจังหวะ (`unstable_cache` ใช้ Data Cache อยู่แล้ว)

หลักการ: **alignment สำคัญกว่า frequency** — การแตะ N ครั้งที่ align กันในหน้าต่างเดียว
ถูกกว่าการแตะ N ครั้งแบบกระจาย เพราะแต่ละการแตะที่กระจายกิน 5 นาที floor แยกกัน

## การเปลี่ยนแปลงรูปธรรม (Tier 1)

### 1. ขยาย `hasPendingJob` TTL: 5 → 30 นาที
- ไฟล์: `web/lib/cache/printer.ts` (`fetchHasPendingJob`, `revalidate: 300` → `1800`)
- ปลอดภัยเพราะ enqueue/claim/ack/retry/markDone เรียก `invalidatePrinterJobs()` ด้วย `{ expire: 0 }`
  บัสต์แคชทันทีอยู่แล้ว → งานจริงที่เข้ามาถูกพิมพ์ทันที ไม่รอ TTL
- TTL เป็นแค่ safety net เผื่อ `revalidateTag` ไม่ propagate ข้าม region/instance; 30 นาทีคือ horizon
  สูงสุดที่งานจะดีเลย์ในกรณีหายากนั้น (ยอมรับได้สำหรับ 2 printer + invalidation ที่เชื่อถือได้)
- ทำเป็น constant ปรับค่าได้ (เช่น `HAS_PENDING_TTL_SEC`)

### 2. รวม `last_seen` write เข้ากับ heartbeat + ขยายเป็น ~30 นาที (global ไม่ใช่ per-instance)
- แทนที่ debounce in-memory ต่อ instance (เดิม 10 นาที, สลับจังหวะ, ทวีคูณตาม warm instance)
- ผูกการเขียน `last_seen` เข้ากับรอบ refresh ของ pending-check ที่ shared ผ่าน Data Cache
  เพื่อให้ "อ่าน pending + เขียน last_seen" เกิดใน Postgres wake เดียวกัน และเป็นจังหวะ global
- กลไกที่เสนอ (รายละเอียดตัดสินใน plan): fold การ update `last_seen`/`last_status_code` เข้าไปใน
  compute function ของ `fetchHasPendingJob` (cached entry ต่อ printer) — เมื่อ entry หมดอายุทุก
  heartbeat การ refresh จะทำทั้ง 2 อย่างใน Postgres session เดียว ทำให้ align โดยธรรมชาติและ
  คุมจังหวะแบบ global
  - การเขียน `last_seen = now` เป็น idempotent (set timestamp) → ปลอดภัยแม้ refresh ทำงานซ้ำ/background
  - `last_status_code` ที่บันทึก = ค่าที่ trigger การ refresh รอบนั้น (พอสำหรับ admin pill)
- ขยาย `isOnline()` threshold 12 → ~35 นาที (`web/lib/format.ts`) ให้สอดคล้องกับ heartbeat 30 นาที
  - printer poll ทุก 5–60s → "online ภายใน 35 นาที" เพียงพอสำหรับ dashboard admin
- **ผลที่ยอมรับ:** online indicator หยาบลงเป็น ~35 นาที (อนุมัติแล้ว)

### 3. ไม่เก็บประวัติงานสำเร็จ (delete-on-success) — bonus เรื่อง storage
- ไฟล์: `web/app/api/cloudprnt/route.ts` (`ackJob`)
- ตอน ack สำเร็จ (code ขึ้นต้น "2"): **DELETE row** แทน UPDATE → status `done`
- **เก็บ failed ไว้** เพื่อให้ admin เห็น/กด retry ได้ (failed = operational state ไม่ใช่ "ประวัติ")
- retention cron (`web/app/api/cron/expire-stuck/route.ts`) เหลือหน้าที่ลบ `failed` เก่า (ยังคงไว้,
  ปรับ filter ให้เหลือเฉพาะ `failed`; **ไม่แตะ `pending`** เด็ดขาด)
- ผลกระทบ UI: dashboard "Recent Jobs" จะเหลือแค่งานที่ค้าง (pending/printing) + failed —
  ไม่เห็นรายการที่พิมพ์สำเร็จแล้ว (อนุมัติแล้ว); ปรับ label/หัวข้อตารางให้สื่อความหมายใหม่

## คาดการณ์ผล (Tier 1)
ตอน idle เหลือแตะ Postgres ~2 ครั้ง/ชม. (heartbeat 30 นาที, อ่าน pending + เขียน last_seen รวมกัน)
+ config read 1/ชม. และจังหวะ align กัน → compute ตื่น ~2 wake × 5 นาที ≈ 10–12 นาที/ชม.
≈ 120–150 hr/mo (ต่ำกว่าเพดาน 191.9 แต่ margin ต้องวัดจริง)

## Verification + เกณฑ์ trigger Tier 2
- หลัง deploy Tier 1: ดู Neon Usage 3–7 วัน ว่า compute hours ลดต่ำกว่า 191.9 จริงไหม
- ถ้า margin บางเกินหรือยังเกิน → escalate **Tier 2**: ย้าย job queue + `last_seen` ไป
  Upstash Redis / Vercel KV → Neon เหลือแค่ printer config (read 1/ชม.) → compute เกือบศูนย์
  - Tier 2 คือจุดที่ "ไม่เก็บประวัติ" จ่ายค่าตัวจริง (queue เป็น ephemeral โดยออกแบบ)
  - แลกกับ dependency ใหม่ + รื้อ enqueue/claim/ack/cache
- นอกขอบเขต task นี้ (ฝั่ง Vercel invocations ไม่ใช่ Neon): Printer A poll ทุก 5s ควรตั้งเป็น 60s
  บนหน้า CloudPRNT web UI ของเครื่อง (เปลี่ยนจากโค้ดไม่ได้)

## ข้อควรระวัง / invariants ที่ต้องคงไว้
- ทุก mutation ของ `printers`/`print_jobs` ต้องเรียก `invalidatePrinters()`/`invalidatePrinterJobs()`
  (ดู memory: project-neon-quota-strategy) — มิฉะนั้น poll เห็นค่า stale ถึง TTL
- retention/expiry **ห้ามลบ `pending`** — printer ที่ offline หลายวันต้องกู้คิวได้
- stuck-job self-heal inline ใน GET handler (>10 นาที → failed) คงไว้เหมือนเดิม
- การขยาย TTL/threshold ต้องทำเป็น named constant เพื่อปรับเมื่อ upgrade เป็น Pro
