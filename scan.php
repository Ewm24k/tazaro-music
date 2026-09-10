<?php
// scan.php - Auto-discovers all files dynamically
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$baseDir = __DIR__ . '/sheet';
$allowedExtensions = ['pdf', 'xml', 'musicxml', 'mid', 'midi'];
$discoveredFiles = [];

$folders = ['piano' => $baseDir . '/piano', 'guitar' => $baseDir . '/guitar'];

foreach ($folders as $instrument => $path) {
    if (is_dir($path)) {
        $files = scandir($path);
        foreach ($files as $file) {
            if ($file === '.' || $file === '..') continue;
            
            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            if (in_array($ext, $allowedExtensions)) {
                $discoveredFiles[] = "sheet/{$instrument}/{$file}";
            }
        }
    }
}

echo json_encode($discoveredFiles);
exit;
