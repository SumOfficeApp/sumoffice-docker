<?php
$manifest = [
    'name' => 'SumOffice for SuiteCRM',
    'description' => 'Open and edit .xlsx, .xlsm, .xlsb and .docx documents in SumOffice (SumSheet, SumDoc) over WOPI. Ctrl+S saves back into the same SuiteCRM document revision.',
    'version' => '1.0.0',
    'author' => 'SumOffice',
    'author_website' => 'https://sumoffice.com',
    'support_email' => 'hello@sumoffice.com',
    'published_date' => '2026-09-25',
    'type' => 'module',
    'is_uninstallable' => true,
    'acceptable_sugar_versions' => ['regex_matches' => ['.*']],
    'acceptable_sugar_flavors' => ['CE'],
];
$installdefs = [
    'id' => 'SumOfficeWopi',
    'copy' => [
        ['from' => '<basepath>/files/sumoffice_wopi.php', 'to' => 'sumoffice_wopi.php'],
        ['from' => '<basepath>/files/custom/modules/SumOffice', 'to' => 'custom/modules/SumOffice'],
        ['from' => '<basepath>/files/custom/modules/Documents/metadata/detailviewdefs.php', 'to' => 'custom/modules/Documents/metadata/detailviewdefs.php'],
    ],
    'entrypoints' => [
        ['from' => '<basepath>/files/custom/Extension/application/Ext/EntryPointRegistry/SumOffice.php', 'to_module' => 'application'],
    ],
    'vardefs' => [
        ['from' => '<basepath>/files/custom/Extension/modules/Documents/Ext/Vardefs/sumoffice.php', 'to_module' => 'Documents'],
    ],
    'language' => [
        ['from' => '<basepath>/files/custom/Extension/modules/Documents/Ext/Language/en_us.sumoffice.php', 'to_module' => 'Documents', 'language' => 'en_us'],
    ],
    'logic_hooks' => [
        ['module' => 'Documents', 'hook' => 'after_retrieve', 'order' => 90, 'description' => 'SumOffice link',
         'file' => 'custom/modules/SumOffice/DocumentHook.php', 'class' => 'SumOfficeDocumentHook', 'function' => 'fillLink'],
    ],
];
