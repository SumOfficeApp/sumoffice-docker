<?php
namespace Espo\Modules\SumOffice\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\SumOffice\Tools\Wopi;

/** WOPI LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK: POST /api/v1/SumOffice/wopi/files/{id} */
class Locks implements Action
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
        $op = (string) $request->getHeader('X-WOPI-Override');
        $sent = (string) $request->getHeader('X-WOPI-Lock');
        $id = $attachment->getId();
        $lock = $this->wopi->lock($id);

        if ($op === 'GET_LOCK') {
            return $response->setHeader('X-WOPI-Lock', $lock ?? '');
        }
        if (!in_array($op, ['LOCK', 'UNLOCK', 'REFRESH_LOCK'], true)) {
            return $response->setStatus(501);
        }
        if (!$payload['w'] || !$this->wopi->canWrite($user, $attachment)) {
            return $response->setStatus(401);
        }
        if ($op === 'LOCK') {
            $old = $request->getHeader('X-WOPI-OldLock');
            if ($lock !== null && $lock !== $sent && $lock !== $old) {
                // The same person reopening the file (a closed tab, a reload) gets a new editor session
                // with a new lock id while the old lock still has up to 30 minutes to run. Refusing it
                // leaves them in an editor that cannot save. Another person's lock is still refused.
                if ($this->wopi->lockOwner($id) !== $user->getId()) {
                    return $response->setStatus(409)->setHeader('X-WOPI-Lock', $lock);
                }
                $GLOBALS['log']->info("SumOffice: lock on attachment $id taken over by the same user's new session");
            }
            $this->wopi->setLock($id, $sent, $user->getId());

            return $response;
        }
        if ($lock === null || $lock !== $sent) {
            return $response->setStatus(409)->setHeader('X-WOPI-Lock', $lock ?? '');
        }
        $this->wopi->setLock($id, $op === 'UNLOCK' ? null : $sent);

        return $response;
    }
}
