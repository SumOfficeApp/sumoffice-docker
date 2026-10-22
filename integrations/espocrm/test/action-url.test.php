<?php
// php test/action-url.test.php — the editor address gets the person's language (no EspoCRM needed).
// Run with any PHP 8.1+, e.g.: docker run --rm -v "$PWD":/w -w /w espocrm/espocrm:10.0.10 php test/action-url.test.php
namespace Espo\Core { class AclManager {} }
namespace Espo\Core\Api { interface Request {} interface Response {} }
namespace Espo\Core\FileStorage { class Manager {} }
namespace Espo\Core\ORM { class EntityManager {} }
namespace Espo\Core\Utils { class Config {} }
namespace Espo\Entities { class Attachment {} class User {} }
namespace {
    require __DIR__ . '/../files/custom/Espo/Modules/SumOffice/Tools/Wopi.php';
    $wopi = (new ReflectionClass(\Espo\Modules\SumOffice\Tools\Wopi::class))->newInstanceWithoutConstructor();
    $cases = [
        // SumSheet publishes the MS-WOPI placeholder: it is filled, not dropped.
        ['https://o.example.com/sheets/wopi/edit?<ui=UI_LLCC&>', 'en_US', 'https://o.example.com/sheets/wopi/edit?ui=en-US&'],
        ['https://o.example.com/sheets/wopi/edit?<ui=UI_LLCC&><rs=DC_LLCC&>', 'de_DE', 'https://o.example.com/sheets/wopi/edit?ui=de-DE&'],
        // SumDoc publishes none: without a language it showed its build default (Russian) to an English user.
        ['https://o.example.com/docs/wopi/edit?', 'en_US', 'https://o.example.com/docs/wopi/edit?ui=en-US&lang=en&'],
        ['https://o.example.com/slides/wopi/edit', 'en_GB', 'https://o.example.com/slides/wopi/edit?ui=en-GB&lang=en&'],
        // A host-given language is never overridden.
        ['https://o.example.com/docs/wopi/edit?lang=ru&', 'en_US', 'https://o.example.com/docs/wopi/edit?lang=ru&'],
    ];
    $failed = 0;
    foreach ($cases as [$src, $lang, $want]) {
        $got = $wopi->actionUrl($src, $lang);
        if ($got !== $want) { $failed++; echo "FAIL $src [$lang]\n  want $want\n  got  $got\n"; }
    }
    echo $failed ? "$failed failed\n" : count($cases) . " passed\n";
    exit($failed ? 1 : 0);
}
