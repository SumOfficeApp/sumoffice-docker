<?php
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}
require_once 'custom/modules/SumOffice/SumOfficeWopi.php';

/** Fills the "Open in SumOffice" link of a Document whose latest revision is an Excel or Word file. */
class SumOfficeDocumentHook
{
    public function fillLink($bean, $event, $arguments)
    {
        $ext = strtolower(pathinfo((string) $bean->filename, PATHINFO_EXTENSION));
        if ($bean->document_revision_id && in_array($ext, SumOfficeWopi::EXTENSIONS, true)) {
            $bean->sumoffice_link = SumOfficeWopi::siteUrl() . '/legacy/index.php?entryPoint=sumofficeOpen&record=' . urlencode($bean->document_revision_id);
        }
    }
}
