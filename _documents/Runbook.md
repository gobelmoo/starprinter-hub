# Runbook — Star Printer Hub Operations

คู่มือดูแลระบบหลังส่งมอบ — สำหรับ admin / on-call

---

## 1. โครงสร้างพื้นฐาน

| Layer | บริการที่ใช้ | URL/หน้า |
|---|---|---|
| App (production) | Vercel (Next.js) | `https://starprinter-hub.vercel.app` |
| DB | Neon Postgres (project: `starprinter-hub`) | https://console.neon.tech |
| Source | GitHub repo | `widelynext/starprinter-hub` |
| Vercel project | `widelynexts-projects/starprinter-hub` | https://vercel.com/widelynexts-projects/starprinter-hub |

> **สำคัญ — ENV var:** ระบบใช้ `STARPRINTER_DB_URL` (ไม่ใช่ `POSTGRES_URL`) เพราะ Vercel marketplace storage integration เก่าใน team auto-inject `POSTGRES_URL` ตอน runtime ทับค่าที่เราตั้ง

Project structure: ดู `_documents/Implementation_Plan_Simple.md`

---

## 2. การ Deploy

### Production deploy (จากเครื่อง dev)

```bash
cd web

# ครั้งแรก: push env vars ขึ้น Vercel
./scripts/push-env-to-vercel.sh

# Deploy
vercel --prod
```

หลัง deploy สำเร็จ Vercel จะ print URL ของ production deployment

### Re-deploy หลังแก้โค้ด

```bash
git push                # ถ้า GitHub integration เปิดอยู่ Vercel auto-deploy
# หรือ deploy ตรงจาก CLI:
vercel --prod
```

### Rollback

ใน Vercel Dashboard → Project → Deployments → คลิก deployment เดิมที่ปกติ → **Promote to Production**

---

## 3. การจัดการ Printer

### เพิ่ม printer ใหม่

ใช้ Drizzle Studio (visual) — รันบนเครื่อง dev:

```bash
cd web
pnpm db:studio       # เปิด browser → คลิก printers → + Insert
```

กรอก:
- `mac_address` — MAC ของเครื่องพิมพ์ ลงรูปแบบ `00:11:62:xx:xx:xx` (ตัวพิมพ์เล็ก, มี colon)
- `name` — ชื่อ user-facing เช่น "ครัวสาขาบางนา"
- `branch_code` — รหัสสาขาที่ Zoho จะส่งเข้ามา เช่น `BKK01`
- `is_active` — ติ๊ก true (default)

หรือ raw SQL ผ่าน Neon console (https://console.neon.tech → project → SQL Editor):

```sql
INSERT INTO printers (mac_address, name, branch_code)
VALUES ('00:11:62:00:00:01', 'Branch BKK01', 'BKK01');
```

### ตั้งค่าเครื่องพิมพ์ Star

1. หา IP เครื่องพิมพ์บน LAN (พิมพ์ self-test, ดูตรง "IP address")
2. เปิดหน้าเว็บ `http://<printer-ip>` (default user/pass อยู่ในคู่มือ printer)
3. เมนู **CloudPRNT settings**:
   - Server URL: `https://<your-domain>/api/cloudprnt`
   - Polling interval: `30 seconds`
4. **Save** + **Reboot**

หลัง reboot เครื่องพิมพ์จะเริ่ม poll ภายใน 30 วินาที — เปิด `https://<your-domain>/` แล้วดู printer ขึ้น "online"

### ปิดใช้ printer ชั่วคราว

ใน Drizzle Studio → printers → set `is_active = false`
หรือ raw SQL:
```sql
UPDATE printers SET is_active = false WHERE mac_address = '00:11:62:...';
```

ระบบจะตอบ `jobReady:false` กับเครื่องนี้ตลอด (ไม่พิมพ์)

---

## 4. การจัดการ Secret

### Rotate ZOHO_API_KEY (เปลี่ยนรหัสที่ Zoho ใช้ยิง webhook)

```bash
cd web
NEW_KEY=$(openssl rand -hex 32)

# Update local
sed -i.bak "s|^ZOHO_API_KEY=.*|ZOHO_API_KEY=$NEW_KEY|" .env.local && rm .env.local.bak

# Update Vercel
vercel env rm ZOHO_API_KEY production --yes
echo "$NEW_KEY" | vercel env add ZOHO_API_KEY production

# Re-deploy เพื่อให้ env ใหม่ active
vercel --prod
```

จากนั้นไปที่ Zoho Creator → form workflow → action → Header → update `x-api-key` เป็น `$NEW_KEY`

### Rotate ADMIN_PASSWORD

```bash
NEW_PASS='your-new-password-here'
sed -i.bak "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$NEW_PASS|" .env.local && rm .env.local.bak
vercel env rm ADMIN_PASSWORD production --yes
echo "$NEW_PASS" | vercel env add ADMIN_PASSWORD production
vercel --prod
```

> **หมายเหตุ:** การเปลี่ยน `ADMIN_COOKIE_SECRET` จะ kick admin ทุกคนออก (cookie เดิมใช้ไม่ได้)

### Rotate CRON_SECRET

```bash
vercel env rm CRON_SECRET production --yes
openssl rand -hex 32 | vercel env add CRON_SECRET production
vercel --prod
```

Vercel Cron จะ pickup CRON_SECRET ใหม่อัตโนมัติ ไม่ต้องตั้งที่ใดเพิ่ม

---

## 5. การตรวจสอบและ Debug

### ดูสถานะภาพรวม

`https://<your-domain>/` (login ด้วย ADMIN_PASSWORD)
- ตาราง Printers — online/offline + สถานะปัจจุบัน (200 OK / 410 Out of paper / 420 Cover open ฯลฯ)
- ตาราง Recent Jobs — ดูงานล่าสุด 50 ตัว, คลิก `view` → ดูรายละเอียด

### ดู production log

```bash
vercel logs <deployment-url> --follow
```

หรือใน Vercel Dashboard → Project → Deployments → คลิก deployment → tab **Runtime Logs**

### ตรวจสอบ DB ตรง ๆ

```bash
cd web
pnpm db:studio
```

หรือ Neon console → SQL Editor → query:
```sql
-- งานที่ค้างอยู่
SELECT id, source_job_id, status, created_at FROM print_jobs WHERE status IN ('pending', 'printing');

-- งานที่ failed
SELECT id, source_job_id, error_message, created_at FROM print_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20;

-- ดูประวัติ printer
SELECT name, mac_address, last_seen_at, last_status_code FROM printers;
```

---

## 6. Troubleshooting

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
|---|---|---|
| Printer ขึ้น offline ในหน้าแรก | ไฟดับ / สาย LAN หลุด / ตั้ง CloudPRNT URL ผิด | ตรวจไฟ + LAN, login เข้า printer ดู CloudPRNT URL ตรงกับ production domain |
| Order จาก Zoho เข้าระบบแต่ไม่พิมพ์ | `branch_code` ไม่ตรงกับ printer ที่ active | ดูใน `/jobs/[id]` → error message + ตรวจ DB ว่ามี printer ที่ branch_code ตรง + is_active=true |
| Order มี status `failed` พร้อม "printer code: 420" | ฝา printer เปิด | ปิดฝา + คลิก "Retry" ในหน้า job |
| Order มี status `failed` พร้อม "printer code: 410" | กระดาษหมด | เปลี่ยนกระดาษ + Retry |
| Status ค้าง `printing` นาน | DELETE จาก printer หาย / printer ค้าง | รอ cron expire-stuck (10 นาที) จะ mark failed อัตโนมัติ หรือ manual mark-done ในหน้า job |
| Login ไม่ผ่านทั้งที่ password ถูก | `ADMIN_COOKIE_SECRET` ใน production env ว่าง | ตรวจ Vercel env vars + re-deploy |
| Zoho ยิงมาได้ 401 | `x-api-key` ไม่ตรงกับ ZOHO_API_KEY ใน Vercel | ดู section "Rotate ZOHO_API_KEY" |
| Cron ไม่ทำงาน (job ค้างนาน) | `CRON_SECRET` ไม่ตรง / vercel.json ไม่ถูก deploy | ตรวจ Vercel Dashboard → Functions → Crons + log |

---

## 7. Cost monitoring

Vercel Dashboard → Project → tab **Usage** ดู
- **Function invocations** — ระวังถ้าใกล้ limit ของ Pro plan (1M/เดือน)
  - ถ้าใกล้ → เพิ่ม polling interval ในหน้าเว็บ printer (เช่น 30s → 60s)
- **Bandwidth** — ปกติน้อย (ใบเสร็จ text/plain เล็กมาก)
- **Build minutes** — ขึ้นเฉพาะตอน deploy

Neon Dashboard → ดู
- **Compute hours** — Free tier 100 hours/เดือน เพียงพอสำหรับโหลดร้านอาหาร

---

## 8. Backup & Recovery

### Neon

Neon Free tier มี Point-in-time restore 24 ชั่วโมง
- Console → Project → Branches → `main` → **Restore** → เลือกเวลา
- (ถ้าต้องการ retention ยาว ต้อง upgrade plan)

### Manual export

```bash
pg_dump "$POSTGRES_URL_NON_POOLING" > backup-$(date +%Y%m%d).sql
```

### Restore

```bash
psql "$POSTGRES_URL_NON_POOLING" < backup-YYYYMMDD.sql
```

---

## 9. Contact

- Code & deploy: WidelyNext team
- Bug after warranty: ตกลงรายเดือนแยก
- Vercel account: `widelynext's project`
- Neon account: `<email ที่ใช้สมัคร>`

---

## 10. cputil binary (markup → printer bytes)

ระบบใช้ Star CPUtil 2.0.1 (ที่ `web/bin/cputil-linux-x64`) แปลง Star Markup → StarPRNT command stream ที่ printer เข้าใจ

### License

**Star Micronics proprietary** — ไม่ใช่ open source อ่าน LA ใน `/tmp/cloudprnt-sdk/LICENSE` หรือ `php_queue_v200/SoftwareLicenseAgreement.pdf` ก่อน redistribute

ก่อน production launch: email ขอ confirmation จาก Star Asia (Thailand distributor) ว่า bundle binary ใน Vercel function ตามรูปแบบนี้ไม่ขัดกับเงื่อนไข

### Rebuild

ถ้าต้องการ update เป็น cputil version ใหม่:

```bash
cd web
./scripts/build-cputil.sh all   # สร้างทั้ง current platform + linux-x64
```

ต้องลง .NET SDK 8+ ก่อน script จะ clone source + build ให้

### Per-platform binaries

| File | Used by |
|---|---|
| `web/bin/cputil-linux-x64` | **committed in git** — ใช้ใน Vercel deploy |
| `web/bin/cputil-darwin-arm64` หรือ `-x64` | gitignored — สำหรับ local dev บน Mac (build เอง) |

Wrapper `lib/cputil.ts` เลือก binary ตาม `process.platform` + `process.arch` อัตโนมัติ

### Bundle ใน Vercel

`next.config.ts` มี `outputFileTracingIncludes` ทำให้ Vercel เก็บ `cputil-linux-x64` ไปกับ function bundle ของ `/api/cloudprnt`

ตรวจ size หลัง deploy ใน Vercel Dashboard → Function → Source — ขนาด function ปกติ ~150 MB (cputil 70 MB + Next.js + node_modules)
