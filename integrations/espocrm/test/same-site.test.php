<?php
// php test/same-site.test.php — when the editor opens inside EspoCRM and when as a whole tab (no EspoCRM needed).
// Run with any PHP 8.1+, e.g.: docker run --rm -v "$PWD":/w -w /w espocrm/espocrm:10.0.10 php test/same-site.test.php
namespace Espo\Core { class AclManager {} }
namespace Espo\Core\Api { interface Request {} interface Response {} }
namespace Espo\Core\FileStorage { class Manager {} }
namespace Espo\Core\ORM { class EntityManager {} }
namespace Espo\Core\Utils { class Config {} }
namespace Espo\Entities { class Attachment {} class Integration {} class User {} }
namespace {
    require __DIR__ . '/../files/custom/Espo/Modules/SumOffice/Tools/Wopi.php';
    $cases = [
        // One address, or neighbours under one domain: the editor's cookie is first-party in a frame.
        ['crm.example.com', 'crm.example.com', true],
        ['office.example.com', 'crm.example.com', true],
        ['office.example.co.uk', 'crm.example.co.uk', true],
        // A partner's EspoCRM against SumOffice-hosted editors: another site, open as a whole tab.
        ['espocrm-demo.sumoffice.com', 'test.espocrm.com', false],
        ['office.a.co.uk', 'crm.b.co.uk', false],
        ['127.0.0.1', 'localhost', false],
        ['', 'crm.example.com', false],
    ];
    $failed = 0;
    foreach ($cases as [$editor, $crm, $want]) {
        $got = \Espo\Modules\SumOffice\Tools\Wopi::sameSite($editor, $crm);
        if ($got !== $want) { $failed++; echo "FAIL $editor vs $crm: want " . var_export($want, true) . "\n"; }
    }
    echo $failed ? "$failed failed\n" : count($cases) . " passed\n";
    exit($failed ? 1 : 0);
}
