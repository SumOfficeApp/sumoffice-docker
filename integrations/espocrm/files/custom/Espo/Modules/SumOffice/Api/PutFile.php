<?php
namespace Espo\Modules\SumOffice\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\SumOffice\Tools\Wopi;

/** WOPI PutFile: POST /api/v1/SumOffice/wopi/files/{id}/contents, X-WOPI-Override: PUT */
class PutFile implements Action
{
    public function __construct(private Wopi $wopi) {}

    public function process(Request $request): Response
    {
        $response = ResponseComposer::empty();
        $entered = $this->wopi->enter($request, $response);
        if (!$entered) {
            return $response;
        }
        [$payload, $user, $attachment] = $entered;
        if ($request->getHeader('X-WOPI-Override') !== 'PUT') {
            return $response->setStatus(400);
        }
        if (!$payload['w'] || !$this->wopi->canWrite($user, $attachment)) {
            return $response->setStatus(401);
        }
        $lock = $this->wopi->lock($attachment->getId());
        $sent = (string) $request->getHeader('X-WOPI-Lock');
        if ($lock !== null && $lock !== $sent) {
            return $response->setStatus(409)->setHeader('X-WOPI-Lock', $lock);
        }
        if ($lock === null && (int) $attachment->get('size') > 0) {
            // MS-WOPI: an unlocked, non-empty file is only written under a lock.
            return $response->setStatus(409)->setHeader('X-WOPI-Lock', '');
        }
        $body = (string) $request->getBodyContents();
        $this->wopi->write($attachment, $body);

        return $response->setHeader('X-WOPI-ItemVersion', md5($body));
    }
}
