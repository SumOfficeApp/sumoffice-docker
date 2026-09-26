<?php
/*
 * SumOffice for SuiteCRM — the licence gate.
 *
 * The store requires an isValid() check at a critical code point. Opening a document for
 * editing is that point: without a valid licence the editor is never handed a token.
 * The check lives here, next to the library, so it is found where the store looks for it.
 */
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

require_once 'modules/SumOffice/license/SumOfficeOutfittersLicense.php';

class SumOfficeLicenseGate
{
    /** True when this SuiteCRM instance holds a valid SumOffice licence. */
    public static function allowed()
    {
        return SumOfficeOutfittersLicense::isValid('SumOffice');
    }
}
