<?php
/*
 * Runs after install and after every upgrade of the extension.
 * Since 1.0.4 the settings live in Administration → Integrations → SumOffice. An upgrade from 1.0.3
 * carries the values it kept in data/config.php over, turned on when a Discovery URL was set.
 * An existing integration record is never overwritten; proof verification stays on unless someone
 * turned it off on purpose.
 */
class AfterInstall
{
    public function run($container, $params = [])
    {
        $entityManager = $container->getByClass(\Espo\ORM\EntityManager::class);
        // The Integration repository returns a new, unsaved record for an id it does not have.
        $integration = $entityManager->getEntityById('Integration', 'SumOffice');
        if ($integration && !$integration->isNew()) {
            if ($integration->get('sumofficeVerifyProof') === null) {
                $integration->set('sumofficeVerifyProof', true);
                $entityManager->saveEntity($integration);
            }
            return;
        }
        $config = $container->getByClass(\Espo\Core\Utils\Config::class);
        $url = trim((string) $config->get('sumofficeDiscoveryUrl'));
        $integration = $integration ?: $entityManager->getNewEntity('Integration');
        $integration->set('id', 'SumOffice');
        $integration->set([
            'enabled' => $url !== '',
            'sumofficeDiscoveryUrl' => $url !== '' ? $url : null,
            'sumofficeVerifyProof' => $config->get('sumofficeVerifyProof') !== false,
            'sumofficeCaBundle' => $config->get('sumofficeCaBundle') ?: null,
            'sumofficeEditorWindow' => 'auto',
        ]);
        $entityManager->saveEntity($integration);
    }
}
