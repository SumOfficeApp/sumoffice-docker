<?php
namespace Espo\Modules\SumOffice\EntryPoints;

use Espo\Core\Acl;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\EntryPoint\EntryPoint;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Error;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Exceptions\NotFound;
use Espo\Core\ORM\EntityManager;
use Espo\Core\Utils\Config;
use Espo\Entities\Attachment;
use Espo\Entities\User;
use Espo\Modules\SumOffice\Tools\Wopi;

/** ?entryPoint=sumOfficeOpen&id={attachmentId} — opens the file in SumOffice for the signed-in person. */
class SumOfficeOpen implements EntryPoint
{
    public function __construct(
        private EntityManager $entityManager,
        private Acl $acl,
        private User $user,
        private Config $config,
        private Wopi $wopi
    ) {}

    public function run(Request $request, Response $response): void
    {
        $id = (string) $request->getQueryParam('id');
        if ($id === '') {
            throw new BadRequest('No id.');
        }
        /** @var ?Attachment $attachment */
        $attachment = $this->entityManager->getEntityById(Attachment::ENTITY_TYPE, $id);
        if (!$attachment) {
            throw new NotFound();
        }
        if (!$this->acl->checkEntity($attachment)) {
            throw new Forbidden();
        }
        $ext = strtolower(pathinfo((string) $attachment->getName(), PATHINFO_EXTENSION));
        if (!in_array($ext, Wopi::EXTENSIONS, true)) {
            throw new BadRequest("SumOffice does not open .$ext files.");
        }
        $discovery = $this->wopi->discovery();
        if (!$discovery) {
            throw new Error('SumOffice is not configured: set sumofficeDiscoveryUrl.');
        }
        $canWrite = $this->wopi->canWrite($this->user, $attachment);
        $action = $discovery['actions']["$ext|" . ($canWrite ? 'edit' : 'view')] ?? $discovery['actions']["$ext|edit"] ?? null;
        if (!$action) {
            throw new Error("SumOffice discovery has no action for .$ext.");
        }
        $site = rtrim((string) $this->config->get('siteUrl'), '/');
        $wopiSrc = "$site/api/v1/SumOffice/wopi/files/" . $attachment->getId();
        $sep = str_ends_with($action, '?') || str_ends_with($action, '&') ? '' : (str_contains($action, '?') ? '&' : '?');
        $target = $action . $sep . 'WOPISrc=' . rawurlencode($wopiSrc);
        [$token, $expires] = $this->wopi->makeToken($this->user->getId(), $attachment->getId(), $canWrite);
        $h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES);
        $response->setHeader('Content-Type', 'text/html; charset=utf-8');
        $response->writeBody('<!doctype html><html><head><meta charset="utf-8"><title>' . $h((string) $attachment->getName()) . '</title>'
            . '<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>'
            . '<form id="sumoffice" action="' . $h($target) . '" method="post" target="sumoffice_frame">'
            . '<input type="hidden" name="access_token" value="' . $h($token) . '">'
            . '<input type="hidden" name="access_token_ttl" value="' . ($expires * 1000) . '"></form>'
            . '<iframe name="sumoffice_frame" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>'
            . '<script>document.getElementById("sumoffice").submit();</script></body></html>');
    }
}
