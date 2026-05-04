<?php

$printFile = "print.txt";
$dataFile  = "receipt.json";

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');

    echo json_encode([
        "jobReady" => file_exists($printFile),
        "mediaTypes" => ["text/plain"]
    ]);

    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    header('Content-Type: text/plain');

    $data = json_decode(file_get_contents($dataFile), true);

    $total = $data['rent'] + $data['water'] + $data['electric'];

    echo "APARTMENT RECEIPT\n";
    echo "----------------------------\n";
    echo "Room : ".$data['room']."\n";
    echo "Tenant : ".$data['tenant']."\n";
    echo "----------------------------\n";
    echo "Rent : ".$data['rent']."\n";
    echo "Water : ".$data['water']."\n";
    echo "Electric : ".$data['electric']."\n";
    echo "----------------------------\n";
    echo "TOTAL : ".$total."\n";
    echo "----------------------------\n";
    echo "Date : ".date('Y-m-d H:i')."\n\n\n";

    // 
    if (file_exists($printFile)) unlink($printFile);
    if (file_exists($dataFile)) unlink($dataFile);

    exit;
}
?>