# PHP Example — เรียก Star Printer Hub API

ตัวอย่าง code PHP สำหรับส่ง print job ไปยัง `POST /api/print/jobs`

---

## ตัวอย่างพื้นฐาน (cURL)

```php
<?php

$apiUrl = "https://starprinter-hub.vercel.app/api/print/jobs";
$apiKey = "<your-api-key>"; // secret ที่ WidelyNext แจ้งให้

$payload = [
    "printerId"   => "725691e6-eec5-4724-ace4-4321c8683ff4",
    "referenceId" => "Test 1",
    "markup"      => "[align: centre]ใบเสร็จ\n[cut]"
];

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => [
        "Content-Type: application/json",
        "x-api-key: {$apiKey}",
    ],
]);

$response   = curl_exec($ch);
$httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError  = curl_error($ch);
curl_close($ch);

if ($curlError) {
    echo "cURL error: {$curlError}\n";
    exit(1);
}

$result = json_decode($response, true);

if ($httpStatus === 200 && !empty($result["ok"])) {
    echo "Success — jobId: {$result['jobId']}\n";
} else {
    echo "Error (HTTP {$httpStatus}): {$response}\n";
}
```

---

## ตัวอย่างแบบ function (reusable)

```php
<?php

function sendPrintJob(string $printerId, string $markup, ?string $referenceId = null): array
{
    $apiUrl = "https://starprinter-hub.vercel.app/api/print/jobs";
    $apiKey = getenv("PRINT_API_KEY") ?: "<your-api-key>";

    $payload = [
        "printerId" => $printerId,
        "markup"    => $markup,
    ];
    if ($referenceId !== null) {
        $payload["referenceId"] = $referenceId;
    }

    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => [
            "Content-Type: application/json",
            "x-api-key: {$apiKey}",
        ],
        CURLOPT_TIMEOUT        => 10,
    ]);

    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error) {
        return ["ok" => false, "error" => $error];
    }

    $body = json_decode($response, true) ?: [];
    $body["_httpStatus"] = $status;
    return $body;
}

// การใช้งาน
$markup = "[align: centre][mag: w 2; h 2]ใบเสร็จ[mag]\n"
        . "[align: left]\n"
        . "[column: left: ผัดไทย ×2;     right: 240.00]\n"
        . "[column: left: ต้มยำ ×1;      right: 80.00]\n"
        . "[align: right][bold]TOTAL 320.00[/bold]\n"
        . "[feed: lines 2]\n"
        . "[cut]";

$result = sendPrintJob(
    "725691e6-eec5-4724-ace4-4321c8683ff4",
    $markup,
    "ORD-20260505-0001"
);

print_r($result);
```

---

## จุดที่มักจะพลาด

### 1. ต้องส่ง body เป็น JSON string ไม่ใช่ array

❌ ผิด — `CURLOPT_POSTFIELDS` รับ array จะกลายเป็น `multipart/form-data`
```php
CURLOPT_POSTFIELDS => $payload, // <-- array โดน serialize เป็น form
```

✅ ถูก — encode เป็น JSON ก่อน
```php
CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
```

### 2. ต้องใส่ header `Content-Type: application/json`

ถ้าไม่ใส่ ระบบจะ parse body ไม่ได้ → ตอบกลับ
```json
{"error":"Invalid payload","issues":[{"code":"invalid_type","expected":"object","received":"null","path":[],"message":"Expected object, received null"}]}
```
(error เดียวกับที่ลูกค้าเจอ)

### 3. ภาษาไทยใน markup

ใช้ `JSON_UNESCAPED_UNICODE` เพื่อไม่ให้ JSON encode ภาษาไทยเป็น `\uXXXX` (ระบบรับได้ทั้งคู่ แต่อ่าน log ง่ายกว่า)

### 4. `\n` ใน markup

ใน PHP ต้องใช้ double-quoted string `"..."` หรือ heredoc ถึงจะตีความ `\n` เป็น newline จริง — single-quoted `'...'` จะส่งเป็น 2 ตัวอักษร `\` กับ `n`

```php
$markup = "[align: centre]ใบเสร็จ\n[cut]";   // ✅ newline จริง
$markup = '[align: centre]ใบเสร็จ\n[cut]';   // ❌ literal backslash-n
```

---

## Error: "Expected object, received null"

ถ้า response เป็น
```json
{"error":"Invalid payload","issues":[{"code":"invalid_type","expected":"object","received":"null","path":[],"message":"Expected object, received null"}]}
```

แปลว่า server ได้ body มาเป็น `null` — สาเหตุที่เป็นไปได้
- ไม่ได้ใส่ header `Content-Type: application/json`
- ส่ง body เป็น form data แทน JSON (เช่น `CURLOPT_POSTFIELDS` รับ array โดยตรง)
- ใน Zoho Deluge ใช้ `parameters: body_map` แทน `parameters: body_map.toString()` — Deluge จะส่งเป็น form-encoded

**แก้ฝั่ง Deluge** — เปลี่ยน `parameters: body_map` เป็น
```
parameters: body_map.toString()
```
หรือเปลี่ยนเป็น
```
content-type: "application/json"
parameters: body_map.toString()
```

---

## Zoho Deluge — ตัวอย่างที่ถูกต้อง

```
// header
header_map = Map();
header_map.put("x-api-key", "<your-api-key>");
header_map.put("Content-Type", "application/json");

// body
body_map = Map();
body_map.put("printerId", "725691e6-eec5-4724-ace4-4321c8683ff4");
body_map.put("referenceId", "Test 1");
body_map.put("markup", "[align: centre]ใบเสร็จ\n[cut]");

// invokeurl — สังเกต body_map.toString() และ content-type
response = invokeurl
[
    url     : "https://starprinter-hub.vercel.app/api/print/jobs"
    type    : POST
    headers : header_map
    parameters : body_map.toString()
    content-type : "application/json"
];

info response;
return response;
```

### จุดที่ต่างจาก code เดิมของลูกค้า

| ของเดิม (ผิด) | ของใหม่ (ถูก) |
|---|---|
| `parameters: body_map` | `parameters: body_map.toString()` |
| ไม่มี `content-type` ใน invokeurl | เพิ่ม `content-type: "application/json"` |

**เหตุผล:** Deluge `invokeurl` ถ้ารับ Map ตรง ๆ ใน `parameters` จะ serialize เป็น `application/x-www-form-urlencoded` (form data) — server ที่คาด JSON จะ parse body ไม่ได้ → `req.json()` ได้ `null` → ตอบกลับ `Expected object, received null`

`body_map.toString()` แปลง Map เป็น JSON string `{"printerId":"...","referenceId":"...","markup":"..."}` แล้วประกอบกับ `content-type: "application/json"` ระบบจึง parse ได้ถูกต้อง

### ตรวจสอบ response ใน Deluge

```
response = invokeurl [ ... ];
response_map = response.toMap();

if (response_map.get("ok") == true) {
    info "Success — jobId: " + response_map.get("jobId");
} else {
    info "Error: " + response;
}
```

---

## Reference

ดู API spec ฉบับเต็มที่ [API.md](./API.md)
