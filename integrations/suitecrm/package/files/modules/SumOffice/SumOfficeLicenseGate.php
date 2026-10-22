<?php
/*
 * SumOffice for SuiteCRM — the licence gate.
 *
 * The store requires an isValid() check at a critical code point. Opening a document for
 * editing is that point: without a valid licence the editor is never handed a token.
 * Editing sessions that are already open are not cut off (wopi.php does not check).
 *
 * If the store cannot be reached (network failure, store error), the add-on keeps working
 * for GRACE_SECONDS after the last successful check. A refusal from the store itself
 * (key unknown, inactive, trial over, subscription cancelled) blocks at once.
 */
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

require_once 'modules/SumOffice/license/SumOfficeOutfittersLicense.php';

class SumOfficeLicenseGate
{
    const GRACE_SECONDS = 604800; // 7 days

    /**
     * True when this SuiteCRM instance may open documents, otherwise the reason as text.
     */
    public static function check()
    {
        $result = SumOfficeOutfittersLicense::isValid('SumOffice');
        require_once 'modules/Administration/Administration.php';
        $administration = new Administration();
        $administration->retrieveSettings('SumOffice');

        if ($result === true) {
            $lastOk = (int) ($administration->settings['SumOffice_last_ok'] ?? 0);
            if (time() - $lastOk > 3600) {
                $administration->saveSetting('SumOffice', 'last_ok', (string) time());
            }
            return true;
        }
        if (self::isUnreachable($result)) {
            $lastOk = (int) ($administration->settings['SumOffice_last_ok'] ?? 0);
            if ($lastOk > 0 && time() - $lastOk <= self::GRACE_SECONDS) {
                return true;
            }
            return 'The SuiteCRM Store could not be reached to check the licence, and the last successful check was more than 7 days ago. Allow this server to reach https://store.suitecrm.com and try again.';
        }
        return is_string($result) && $result !== '' ? $result : 'The licence key is not valid.';
    }

    /** True when the store did not answer at all, as opposed to answering "no". */
    private static function isUnreachable($result)
    {
        if (!is_string($result) || $result === '') {
            return true; // no answer body: network or store failure
        }
        return strpos($result, 'SugarOutfitters_API::call(): Unable to validate') === 0;
    }

    /** Kept for callers of 1.0.6. */
    public static function allowed()
    {
        return self::check() === true;
    }
}
