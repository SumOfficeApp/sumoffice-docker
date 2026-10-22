<?php
/*
 * SumOffice for SuiteCRM — target of the licence form on license.php
 * (index.php?module=SumOffice&action=outfitterscontroller&to_pdf=1, method=validate|change|add).
 */
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

global $current_user, $currentModule;

if (!is_admin($current_user)) {
    header('HTTP/1.1 403 Forbidden');
    echo json_encode('Only an administrator can change the SumOffice licence key.');
    return;
}

require_once 'modules/SumOffice/license/SumOfficeOutfittersLicense.php';
$currentModule = 'SumOffice';

switch ($_REQUEST['method'] ?? '') {
    case 'validate':
        SumOfficeOutfittersLicense::validate();
        break;
    case 'change':
        SumOfficeOutfittersLicense::change();
        break;
    case 'add':
        SumOfficeOutfittersLicense::add();
        break;
    default:
        header('HTTP/1.1 400 Bad Request');
        echo json_encode('Unknown method.');
}
