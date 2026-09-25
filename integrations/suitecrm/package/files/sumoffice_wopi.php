<?php
/*
 * SumOffice for SuiteCRM — WOPI endpoints (public/legacy/sumoffice_wopi.php).
 *
 *   GET  sumoffice_wopi.php/{revisionId}            CheckFileInfo
 *   POST sumoffice_wopi.php/{revisionId}            LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
 *   GET  sumoffice_wopi.php/{revisionId}/contents   GetFile
 *   POST sumoffice_wopi.php/{revisionId}/contents   PutFile (X-WOPI-Override: PUT)
 *
 * The file id is in the path, so the editor's "/contents" suffix lands where MS-WOPI expects it.
 */
if (!defined('sugarEntry')) {
    define('sugarEntry', true);
}
chdir(__DIR__);
require_once 'include/entryPoint.php';
require_once 'custom/modules/SumOffice/SumOfficeWopi.php';

function sumoffice_reply(int $status, string $body = '', array $headers = [], string $type = 'application/octet-stream'): void
{
    http_response_code($status);
    header('Content-Type: ' . $type);
    foreach ($headers as $name => $value) {
        header("$name: $value");
    }
    echo $body;
    sugar_cleanup(true);
}

$route = trim((string) ($_SERVER['PATH_INFO'] ?? ''), '/');
if (!preg_match('#^([A-Za-z0-9-]+)(/contents)?$#', $route, $m)) {
    sumoffice_reply(404);
}
$revisionId = $m[1];
$contents = isset($m[2]);
$token = (string) ($_GET['access_token'] ?? '');
$payload = SumOfficeWopi::readToken($token, $revisionId);
if (!$payload) {
    sumoffice_reply(401);
}
if (!SumOfficeWopi::proofOk($token)) {
    $GLOBALS['log']->warn("SumOffice: WOPI proof rejected for revision $revisionId");
    sumoffice_reply(500, 'proof', [], 'text/plain');
}

global $current_user;
$current_user = BeanFactory::getBean('Users', $payload['u']);
if (!$current_user || empty($current_user->id) || $current_user->status !== 'Active') {
    sumoffice_reply(401);
}
$loaded = SumOfficeWopi::load($revisionId);
if (!$loaded) {
    sumoffice_reply(404);
}
[$revision, $document] = $loaded;
if (!SumOfficeWopi::canRead($document)) {
    sumoffice_reply(401);
}
$path = SumOfficeWopi::path($revisionId);
$canWrite = $payload['w'] && SumOfficeWopi::canWrite($document);
$method = $_SERVER['REQUEST_METHOD'];
$override = (string) ($_SERVER['HTTP_X_WOPI_OVERRIDE'] ?? '');
$sent = (string) ($_SERVER['HTTP_X_WOPI_LOCK'] ?? '');

if ($contents && $method === 'GET') {
    $data = (string) @file_get_contents($path);
    sumoffice_reply(200, $data, ['X-WOPI-ItemVersion' => md5($data)]);
}
if ($contents && $method === 'POST') {
    if ($override !== 'PUT') {
        sumoffice_reply(400);
    }
    if (!$canWrite) {
        sumoffice_reply(401);
    }
    $lock = SumOfficeWopi::lock($revisionId);
    if ($lock !== null && $lock !== $sent) {
        sumoffice_reply(409, '', ['X-WOPI-Lock' => $lock]);
    }
    if ($lock === null && @filesize($path) > 0) {
        sumoffice_reply(409, '', ['X-WOPI-Lock' => '']);
    }
    $body = (string) file_get_contents('php://input');
    file_put_contents($path, $body, LOCK_EX);
    $document->date_modified = null;
    $document->save(false);
    sumoffice_reply(200, '', ['X-WOPI-ItemVersion' => md5($body)]);
}
if ($method === 'GET') {
    $site = SumOfficeWopi::siteUrl();
    sumoffice_reply(200, json_encode([
        'BaseFileName' => $revision->filename,
        'Size' => (int) @filesize($path),
        'OwnerId' => (string) $document->assigned_user_id,
        'UserId' => (string) $current_user->id,
        'UserFriendlyName' => trim($current_user->full_name ?: $current_user->user_name),
        'Version' => (string) @md5_file($path),
        'UserCanWrite' => (bool) $canWrite,
        'ReadOnly' => !$canWrite,
        'UserCanNotWriteRelative' => true,
        'SupportsLocks' => true,
        'SupportsGetLock' => true,
        'SupportsUpdate' => true,
        'PostMessageOrigin' => preg_replace('#^(https?://[^/]+).*$#', '$1', $site),
    ]), [], 'application/json');
}
// POST without /contents: locks
$lock = SumOfficeWopi::lock($revisionId);
if ($override === 'GET_LOCK') {
    sumoffice_reply(200, '', ['X-WOPI-Lock' => $lock ?? '']);
}
if (!in_array($override, ['LOCK', 'UNLOCK', 'REFRESH_LOCK'], true)) {
    sumoffice_reply(501);
}
if (!$canWrite) {
    sumoffice_reply(401);
}
if ($override === 'LOCK') {
    $old = $_SERVER['HTTP_X_WOPI_OLDLOCK'] ?? null;
    if ($lock !== null && $lock !== $sent && $lock !== $old) {
        sumoffice_reply(409, '', ['X-WOPI-Lock' => $lock]);
    }
    SumOfficeWopi::setLock($revisionId, $sent);
    sumoffice_reply(200);
}
if ($lock === null || $lock !== $sent) {
    sumoffice_reply(409, '', ['X-WOPI-Lock' => $lock ?? '']);
}
SumOfficeWopi::setLock($revisionId, $override === 'UNLOCK' ? null : $sent);
sumoffice_reply(200);
