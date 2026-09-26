<?php
/*
 * SumOffice for SuiteCRM — ?entryPoint=sumofficeOpen&record={revisionId}
 * Opens the Document revision in SumOffice for the signed-in person.
 */
if (!defined('sugarEntry') || !sugarEntry) {

// SuiteCRM Store licence check: the store requires isValid() at a critical code point,
// and opening a document for editing is exactly that point.
if (file_exists('modules/SumOffice/license/SumOfficeOutfittersLicense.php')) {
    require_once 'modules/SumOffice/license/SumOfficeOutfittersLicense.php';
    // the licence gate, spelled out here as well so it is plain at the entry point
    if (!SumOfficeOutfittersLicense::isValid('SumOffice')) {
        header('HTTP/1.1 403 Forbidden');
        echo 'SumOffice: the add-on licence is not valid. An administrator can enter the licence key in Admin > SumOffice.';
        return;
    }
}
    die('Not A Valid Entry Point');
}
require_once 'custom/modules/SumOffice/SumOfficeWopi.php';

global $current_user;
$revisionId = preg_replace('/[^A-Za-z0-9-]/', '', (string) ($_GET['record'] ?? ''));
$loaded = $revisionId !== '' ? SumOfficeWopi::load($revisionId) : null;
if (!$loaded) {
    http_response_code(404);
    die('No such document.');
}
[$revision, $document] = $loaded;
if (!SumOfficeWopi::canRead($document)) {
    http_response_code(403);
    die('No access.');
}
$ext = strtolower(pathinfo((string) $revision->filename, PATHINFO_EXTENSION));
if (!in_array($ext, SumOfficeWopi::EXTENSIONS, true)) {
    http_response_code(415);
    die("SumOffice does not open .$ext files.");
}
$discovery = SumOfficeWopi::discovery();
if (!$discovery) {
    http_response_code(503);
    die('SumOffice is not configured: set sumoffice_discovery_url in config_override.php.');
}
$canWrite = SumOfficeWopi::canWrite($document);
$action = $discovery['actions']["$ext|" . ($canWrite ? 'edit' : 'view')] ?? $discovery['actions']["$ext|edit"] ?? null;
if (!$action) {
    http_response_code(503);
    die("SumOffice discovery has no action for .$ext.");
}
$wopiSrc = SumOfficeWopi::siteUrl() . '/custom/modules/SumOffice/wopi.php/' . $revision->id;
$sep = (substr($action, -1) === '?' || substr($action, -1) === '&') ? '' : (strpos($action, '?') !== false ? '&' : '?');
$target = $action . $sep . 'WOPISrc=' . rawurlencode($wopiSrc);
[$token, $expires] = SumOfficeWopi::makeToken((string) $current_user->id, (string) $revision->id, $canWrite);
$h = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES); };
header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html><head><meta charset="utf-8"><title>' . $h($revision->filename) . '</title>'
    . '<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>'
    . '<form id="sumoffice" action="' . $h($target) . '" method="post" target="sumoffice_frame">'
    . '<input type="hidden" name="access_token" value="' . $h($token) . '">'
    . '<input type="hidden" name="access_token_ttl" value="' . ($expires * 1000) . '"></form>'
    . '<iframe name="sumoffice_frame" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>'
    . '<script>document.getElementById("sumoffice").submit();</script></body></html>';
sugar_cleanup(true);
