<?php
/*
 * Runs after install and after every upgrade of the extension.
 * Writes the defaults the settings page shows, without touching values an administrator already set:
 * proof verification is on unless someone turned it off on purpose.
 */
class AfterInstall
{
    public function run($container, $params = [])
    {
        $config = $container->getByClass(\Espo\Core\Utils\Config::class);
        if ($config->get('sumofficeVerifyProof') !== null) {
            return;
        }
        $writer = $container->getByClass(\Espo\Core\InjectableFactory::class)
            ->create(\Espo\Core\Utils\Config\ConfigWriter::class);
        $writer->set('sumofficeVerifyProof', true);
        $writer->save();
    }
}
