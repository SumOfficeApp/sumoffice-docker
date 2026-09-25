<?php
namespace Espo\Modules\SumOffice\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Utils\Config;
use Espo\Modules\SumOffice\Tools\Wopi;

/** WOPI CheckFileInfo: GET /api/v1/SumOffice/wopi/files/{id} */
class CheckFileInfo implements Action
{
    public function __construct(private Wopi $wopi, private Config $config) {}

    public function process(Request $request): Response
    {
        $response = ResponseComposer::empty();
        $entered = $this->wopi->enter($request, $response);
        if (!$entered) {
            return $response;
        }
        [$payload, $user, $attachment] = $entered;
        $canWrite = $payload['w'] && $this->wopi->canWrite($user, $attachment);
        $site = rtrim((string) $this->config->get('siteUrl'), '/');

        return ResponseComposer::json([
            'BaseFileName' => $attachment->getName(),
            'Size' => (int) $attachment->get('size'),
            'OwnerId' => (string) $attachment->get('createdById'),
            'UserId' => $user->getId(),
            'UserFriendlyName' => $user->getName(),
            'Version' => $this->wopi->version($attachment),
            'UserCanWrite' => $canWrite,
            'ReadOnly' => !$canWrite,
            'UserCanNotWriteRelative' => true,
            'SupportsLocks' => true,
            'SupportsGetLock' => true,
            'SupportsUpdate' => true,
            'PostMessageOrigin' => preg_replace('#^(https?://[^/]+).*$#', '$1', $site),
        ]);
    }
}
