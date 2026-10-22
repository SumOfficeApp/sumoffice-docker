<?php
/*
 * SumOffice for SuiteCRM — post-install.
 *
 * The store forbids overwriting a file the customer may already own, and the Documents
 * detail view is exactly such a file: a customer who touched it in Studio has their own
 * custom/modules/Documents/metadata/detailviewdefs.php. So we do not ship that file.
 * Instead we read whichever version is in force, back it up, and insert our one row.
 *
 * Then the administrator is sent to the licence key page, as the SuiteCRM Store asks.
 */
if (!defined('sugarEntry')) define('sugarEntry', true);

function sumoffice_detailviewdefs_path()
{
    return 'custom/modules/Documents/metadata/detailviewdefs.php';
}

function sumoffice_add_detailview_row()
{
    $ours = sumoffice_detailviewdefs_path();
    $source = null;
    foreach ([$ours, 'modules/Documents/metadata/detailviewdefs.php'] as $candidate) {
        if (file_exists($candidate)) { $source = $candidate; break; }
    }
    if ($source === null) return;               // nothing to extend: add the field in Studio

    $viewdefs = [];
    include $source;
    if (empty($viewdefs['Documents']['DetailView']['panels'])) return;

    // already extended: leave it alone
    if (strpos(var_export($viewdefs, true), 'sumoffice_link') !== false) return;

    $panels =& $viewdefs['Documents']['DetailView']['panels'];
    $firstPanel = array_key_first($panels);
    $panels[$firstPanel][] = [
        ['name' => 'sumoffice_link', 'label' => 'LBL_SUMOFFICE_LINK'],
        '',
    ];

    if (file_exists($ours)) {
        @copy($ours, $ours . '.sumoffice-backup-' . date('Ymd-His'));
    }
    if (!is_dir(dirname($ours))) @mkdir(dirname($ours), 0755, true);
    file_put_contents($ours, "<?php\n\$viewdefs = " . var_export($viewdefs, true) . ";\n");
}

function post_install()
{
    sumoffice_add_detailview_row();

    $licencePage = 'index.php?module=SumOffice&action=license';
    echo '<p><b>SumOffice is installed.</b> Next, enter the licence key from your SuiteCRM Store purchase: '
        . '<a href="' . $licencePage . '" target="_top">SumOffice licence</a> '
        . '(also in Admin &gt; SumOffice licence).</p>'
        . '<script>setTimeout(function () { try { window.location.href = "' . $licencePage . '"; } catch (e) {} }, 3000);</script>';
}
