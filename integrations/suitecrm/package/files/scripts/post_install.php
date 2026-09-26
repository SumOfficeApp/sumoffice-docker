<?php
/*
 * SumOffice for SuiteCRM — post-install.
 *
 * The store forbids overwriting a file the customer may already own, and the Documents
 * detail view is exactly such a file: a customer who touched it in Studio has their own
 * custom/modules/Documents/metadata/detailviewdefs.php. So we do not ship that file.
 * Instead we read whichever version is in force, back it up, and insert our one row.
 */
if (!defined('sugarEntry')) define('sugarEntry', true);

function sumoffice_detailviewdefs_path()
{
    return 'custom/modules/Documents/metadata/detailviewdefs.php';
}

function post_install()
{
    $наш = sumoffice_detailviewdefs_path();
    $истоки = [$наш, 'modules/Documents/metadata/detailviewdefs.php'];
    $источник = null;
    foreach ($истоки as $и) {
        if (file_exists($и)) { $источник = $и; break; }
    }
    if ($источник === null) return;            // нечего дополнять — поле добавят в Studio

    $viewdefs = [];
    include $источник;
    if (empty($viewdefs['Documents']['DetailView']['panels'])) return;

    // уже дополнено — ничего не делаем
    $как_текст = var_export($viewdefs, true);
    if (strpos($как_текст, 'sumoffice_link') !== false) return;

    $панели =& $viewdefs['Documents']['DetailView']['panels'];
    $имя_панели = array_key_first($панели);
    $панели[$имя_панели][] = [
        ['name' => 'sumoffice_link', 'label' => 'LBL_SUMOFFICE_LINK'],
        '',
    ];

    if (file_exists($наш)) {
        @copy($наш, $наш . '.sumoffice-backup-' . date('Ymd-His'));
    }
    if (!is_dir(dirname($наш))) @mkdir(dirname($наш), 0755, true);
    file_put_contents($наш, "<?php\n\$viewdefs = " . var_export($viewdefs, true) . ";\n");
}

function post_uninstall()
{
    // оставляем как есть: снимать своё поле из чужого файла опаснее, чем оставить
}
