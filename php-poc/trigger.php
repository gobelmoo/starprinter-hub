<?php

$printFile = "print.txt";
$dataFile  = "receipt.json";

$data = [
    "tenant"   => $_POST['tenant'] ?? '',
    "room"     => $_POST['room'] ?? '',
    "rent"     => $_POST['rent'] ?? 0,
    "water"    => $_POST['water'] ?? 0,
    "electric" => $_POST['electric'] ?? 0
];

$success = true;
$error = "";

// บันทึกข้อมูลใบเสร็จลงไฟล์ JSON
if (file_put_contents($dataFile, json_encode($data, JSON_UNESCAPED_UNICODE)) === false) {
    $success = false;
    $error = "ไม่สามารถบันทึกไฟล์ receipt.json ได้";
}

// สร้างไฟล์ trigger เพื่อบอกว่ามีงานพิมพ์รอ (jobReady)
if ($success && file_put_contents($printFile, "1") === false) {
    $success = false;
    $error = "ไม่สามารถสร้างไฟล์ print.txt ได้";
}

?>

<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Print Result</title>
<style>
body{
font-family: Arial;
text-align:center;
margin-top:100px;
}
.box{
border:1px solid #ccc;
padding:30px;
display:inline-block;
border-radius:8px;
}
button{
padding:10px 20px;
font-size:16px;
margin-top:20px;
}
.success{color:green;}
.error{color:red;}
</style>
</head>
<body>

<div class="box">

<?php if($success): ?>
<h2 class="success">Already send data to printer.</h2>
<p></p>

<?php else: ?>
<h2 class="error"> Error</h2>
<p><?php echo $error; ?></p>
<?php endif; ?>

<button onclick="window.location='receipt_form.php'">
OK
</button>

</div>

</body>
</html>