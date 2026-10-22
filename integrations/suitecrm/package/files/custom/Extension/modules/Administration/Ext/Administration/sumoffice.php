<?php
$admin_option_defs = [];
$admin_option_defs['Administration']['sumoffice_license'] = [
    'Administration',
    'LBL_SUMOFFICE_LICENSE_TITLE',
    'LBL_SUMOFFICE_LICENSE_DESC',
    './index.php?module=SumOffice&action=license',
];
$admin_group_header[] = ['LBL_SUMOFFICE_ADMIN_HEADER', '', false, $admin_option_defs, 'LBL_SUMOFFICE_ADMIN_HEADER_DESC'];
