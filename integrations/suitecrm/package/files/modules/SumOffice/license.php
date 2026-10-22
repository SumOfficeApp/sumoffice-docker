<?php
/*
 * SumOffice for SuiteCRM — licence key page (Admin > SumOffice licence).
 * index.php?module=SumOffice&action=license
 *
 * Shows the SuiteCRM Store licence form from the store's library. The form posts to
 * outfitterscontroller.php, which validates the key with the store and saves it.
 */
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

global $current_user, $app_strings, $current_language;

if (!is_admin($current_user)) {
    sugar_die(!empty($app_strings['ERR_NOT_ADMIN']) ? $app_strings['ERR_NOT_ADMIN'] : 'Unauthorized access to administration.');
}

require_once 'modules/SumOffice/license/SumOfficeOutfittersLicense.php';
require 'modules/SumOffice/license/config.php';

$license_strings = [];
require 'modules/SumOffice/license/language/en_us.lang.php';
$english = $license_strings;
$languageFile = 'modules/SumOffice/license/language/' . basename((string) $current_language) . '.lang.php';
if ($current_language !== 'en_us' && file_exists($languageFile)) {
    $license_strings = [];
    require $languageFile;
    $license_strings = array_merge($english, $license_strings);
}

$ss = new Sugar_Smarty();
$ss->assign('MODULE', 'SumOffice');
$ss->assign('LICENSE', $license_strings);
$ss->assign('APP', $app_strings);
$ss->assign('IS_SUGAR_6', true);
$ss->assign('CURL_NOT_ENABLED', function_exists('curl_init') ? '' : 'PHP cURL is not enabled on this server, so the licence key cannot be checked with the SuiteCRM Store.');
$ss->assign('file_path', 'include/javascript/jquery/jquery-min.js');
$ss->assign('RETURN_MODULE', 'Administration');
$ss->assign('RETURN_ACTION', 'index');
$ss->assign('license_key', SumOfficeOutfittersLicense::getKey('SumOffice'));
$ss->assign('continue_url', $outfitters_config['continue_url']);
$ss->assign('validate_users', $outfitters_config['validate_users']);
$ss->assign('manage_licensed_users', $outfitters_config['manage_licensed_users']);
$ss->assign('validation_required', false);
$ss->assign('USER_CHOOSER', '');
$ss->assign('current_users', 0);
$ss->assign('licensed_users', 0);
$ss->assign('available_licensed_users', 0);

echo getClassicModuleTitle('Administration', [
    '<a href="index.php?module=Administration&action=index">' . htmlspecialchars((string) translate('LBL_MODULE_NAME', 'Administration'), ENT_QUOTES) . '</a>',
    'SumOffice licence',
], false);
$ss->display('modules/SumOffice/license/tpls/license.tpl');
