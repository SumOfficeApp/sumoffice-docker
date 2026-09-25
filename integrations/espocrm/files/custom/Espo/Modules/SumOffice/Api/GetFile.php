<?php
namespace Espo\Modules\SumOffice\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\SumOffice\Tools\Wopi;

/** WOPI GetFile: GET /api/v1/SumOffice/wopi/files/{id}/contents */
class GetFile implements Action
{
    public function __construct(private Wopi $wopi) {}

    public function process(Request $request): Response
    {
        $response = ResponseComposer::empty();
        $entered = $this->wopi->enter($request, $response);
        if (!$entered) {
            return $response;
        }
        [, , $attachment] = $entered;
        $contents = $this->wopi->read($attachment);

        return $response
            ->setHeader('Content-Type', 'application/octet-stream')
            ->setHeader('X-WOPI-ItemVersion', md5($contents))
            ->writeBody($contents);
    }
}
