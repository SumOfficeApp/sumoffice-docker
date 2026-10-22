<?php
namespace Espo\Modules\SumOffice\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Utils\Config;
use Espo\Entities\User;
use Espo\Modules\SumOffice\Tools\Wopi;

/** GET /api/v1/SumOffice/check — for the settings page: is the editor stack reachable and what does it open. Admin only. */
class Check implements Action
{
    public function __construct(private Wopi $wopi, private User $user, private Config $config) {}

    public function process(Request $request): Response
    {
        if (!$this->user->isAdmin()) {
            throw new Forbidden();
        }
        $url = (string) $this->config->get('sumofficeDiscoveryUrl');
        if ($url === '') {
            return ResponseComposer::json(['ok' => false, 'message' => 'Discovery URL is empty.']);
        }
        $discovery = $this->wopi->discovery(true);
        if (!$discovery) {
            return ResponseComposer::json(['ok' => false, 'url' => $url,
                'message' => 'EspoCRM could not read ' . $url . '. Check that the address is reachable from the EspoCRM server and returns WOPI discovery XML.']);
        }
        $opens = [];
        foreach (Wopi::EXTENSIONS as $ext) {
            if (isset($discovery['actions']["$ext|edit"]) || isset($discovery['actions']["$ext|view"])) {
                $opens[] = $ext;
            }
        }
        $missing = array_values(array_diff(Wopi::EXTENSIONS, $opens));
        $proof = !empty($discovery['proof']['modulus']);
        $verify = $this->config->get('sumofficeVerifyProof', true) !== false;
        $ok = $opens !== [] && (!$verify || $proof);

        return ResponseComposer::json([
            'ok' => $ok,
            'url' => $url,
            'opens' => $opens,
            'missing' => $missing,
            'proofKey' => $proof,
            'verifyProof' => $verify,
            'siteUrl' => (string) $this->config->get('siteUrl'),
            'message' => $ok
                ? 'Connected. Opens: .' . implode(', .', $opens) . ($missing ? '. Not offered by this stack: .' . implode(', .', $missing) : '') . '.'
                : ($opens === [] ? 'Discovery has no actions for ' . implode(', ', Wopi::EXTENSIONS) . '.' : 'Discovery has no proof key while proof verification is on.'),
        ]);
    }
}
