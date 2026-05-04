<?php
/**
 * starprint.php — สคริปต์จำลองการทำงานของเครื่องพิมพ์ Star (CloudPRNT client)
 *
 * ใช้สำหรับทดสอบ flow ของ print.php โดยไม่ต้องมีเครื่องพิมพ์จริง
 *
 * วิธีใช้ (เปิด terminal อีกหน้าต่างหนึ่งแล้วรัน):
 *   php starprint.php
 *
 * สคริปต์จะ poll ไปที่ http://localhost:8000/print.php ทุก ๆ 3 วินาที
 * เมื่อเจอ jobReady = true จะ GET เนื้อหาและพิมพ์ลงหน้าจอเสมือนเครื่องพิมพ์จริง
 */

$endpoint = $argv[1] ?? "http://localhost:8000/print.php";
$interval = 3; // วินาที

echo "[starprint] เริ่ม poll ที่ {$endpoint} (ทุก {$interval} วินาที)\n";

while (true) {
    // 1) POST เพื่อถามสถานะงาน
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            "statusCode" => "200 OK",
            "status"     => "ready",
            "printerMAC" => "00:11:62:00:00:00",
        ]),
        CURLOPT_HTTPHEADER     => ["Content-Type: application/json"],
    ]);
    $body = curl_exec($ch);
    curl_close($ch);

    $resp = json_decode($body, true);

    if (!empty($resp["jobReady"])) {
        echo "\n[starprint] พบงานพิมพ์ — กำลังดึงเนื้อหา ...\n";

        // 2) GET เพื่อรับเนื้อหา
        $content = file_get_contents($endpoint);

        echo "----- BEGIN PRINT -----\n";
        echo $content;
        echo "------ END PRINT ------\n\n";
    } else {
        echo ".";
    }

    sleep($interval);
}
