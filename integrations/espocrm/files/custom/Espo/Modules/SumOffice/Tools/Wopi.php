<?php
/*
 * SumOffice for EspoCRM — WOPI host helper.
 *
 * EspoCRM is the WOPI host (storage), SumOffice is the WOPI client (editor).
 * Everything the editor calls back runs with the rights of the person who
 * opened the file: the token carries their user id, and every read and write
 * goes through EspoCRM's ACL for that user.
 */

namespace Espo\Modules\SumOffice\Tools;

use Espo\Core\AclManager;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\FileStorage\Manager as FileStorageManager;
use Espo\Core\ORM\EntityManager;
use Espo\Core\Utils\Config;
use Espo\Entities\Attachment;
use Espo\Entities\User;

class Wopi
{
    public const EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'docx'];
    private const TOKEN_TTL = 36000;      // seconds
    private const LOCK_TTL = 1800;        // MS-WOPI: 30 minutes
    private const PROOF_WINDOW = 1200;    // MS-WOPI: 20 minutes of clock skew
    private const DISCOVERY_TTL = 3600;

    public function __construct(
        private Config $config,
        private EntityManager $entityManager,
        private AclManager $aclManager,
        private FileStorageManager $fileStorageManager
    ) {}

    // ---- token ----------------------------------------------------------------

    private function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function unb64(string $text): string
    {
        return (string) base64_decode(strtr($text, '-_', '+/'));
    }

    private function secret(): string
    {
        return 'sumoffice-wopi:' . $this->config->get('cryptKey', '') . $this->config->get('passwordSalt', '');
    }

    /** @return array{0: string, 1: int} token and expiry (unix seconds) */
    public function makeToken(string $userId, string $attachmentId, bool $canWrite): array
    {
        $expires = time() + self::TOKEN_TTL;
        $body = $this->b64(json_encode(['u' => $userId, 'a' => $attachmentId, 'w' => $canWrite, 'e' => $expires]));
        $mac = $this->b64(hash_hmac('sha256', $body, $this->secret(), true));

        return [$body . '.' . $mac, $expires];
    }

    /** @return ?array{u: string, a: string, w: bool, e: int} */
    public function readToken(string $token, string $attachmentId): ?array
    {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2) {
            return null;
        }
        [$body, $mac] = $parts;
        if (!hash_equals($this->b64(hash_hmac('sha256', $body, $this->secret(), true)), $mac)) {
            return null;
        }
        $payload = json_decode($this->unb64($body), true);
        if (!is_array($payload) || ($payload['a'] ?? null) !== $attachmentId || ($payload['e'] ?? 0) < time()) {
            return null;
        }

        return $payload;
    }

    // ---- discovery and proof keys ---------------------------------------------

    private function cacheFile(string $name): string
    {
        $dir = 'data/cache/sumoffice';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        return $dir . '/' . $name;
    }

    /** @return ?array{actions: array<string, string>, proof: ?array<string, string>} */
    public function discovery(): ?array
    {
        $url = $this->config->get('sumofficeDiscoveryUrl');
        if (!$url) {
            return null;
        }
        $file = $this->cacheFile('discovery.json');
        if (is_file($file) && time() - filemtime($file) < self::DISCOVERY_TTL) {
            $cached = json_decode((string) file_get_contents($file), true);
            if (is_array($cached) && ($cached['url'] ?? null) === $url) {
                return $cached;
            }
        }
        $ca = $this->config->get('sumofficeCaBundle');
        $context = stream_context_create([
            'http' => ['timeout' => 15],
            'ssl' => $ca ? ['cafile' => $ca, 'verify_peer' => true] : ['verify_peer' => true],
        ]);
        $xml = @file_get_contents($url, false, $context);
        if ($xml === false) {
            return null;
        }
        $doc = @simplexml_load_string($xml);
        if (!$doc) {
            return null;
        }
        $actions = [];
        foreach ($doc->xpath('//action') ?: [] as $action) {
            $ext = strtolower((string) $action['ext']);
            $name = (string) $action['name'];
            $src = (string) $action['urlsrc'];
            if ($ext && $name && $src && !isset($actions["$ext|$name"])) {
                // Placeholders like <ui=UI_LLCC&> are optional; drop them.
                $actions["$ext|$name"] = preg_replace('/<[^>]*>/', '', $src);
            }
        }
        $proof = null;
        $key = $doc->xpath('//proof-key');
        if ($key) {
            $proof = [];
            foreach ($key[0]->attributes() as $k => $v) {
                $proof[(string) $k] = (string) $v;
            }
        }
        $result = ['url' => $url, 'actions' => $actions, 'proof' => $proof];
        @file_put_contents($file, json_encode($result));

        return $result;
    }

    private function derLength(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }
        $bytes = ltrim(pack('N', $length), "\0");

        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    private function derInteger(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ($bytes === '' || ord($bytes[0]) & 0x80) {
            $bytes = "\0" . $bytes;
        }

        return "\x02" . $this->derLength(strlen($bytes)) . $bytes;
    }

    /** RSA public key PEM from discovery's base64 modulus and exponent. */
    private function publicKey(string $modulus, string $exponent)
    {
        $rsa = $this->derInteger(base64_decode($modulus)) . $this->derInteger(base64_decode($exponent));
        $rsa = "\x30" . $this->derLength(strlen($rsa)) . $rsa;
        $bitString = "\x03" . $this->derLength(strlen($rsa) + 1) . "\0" . $rsa;
        $algorithm = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
        $spki = "\x30" . $this->derLength(strlen($algorithm . $bitString)) . $algorithm . $bitString;
        $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";

        return openssl_pkey_get_public($pem);
    }

    public function proofOk(Request $request, string $token): bool
    {
        if ($this->config->get('sumofficeVerifyProof', true) === false) {
            return true;
        }
        $keys = $this->discovery()['proof'] ?? null;
        if (!$keys || empty($keys['modulus'])) {
            return false;
        }
        $ticks = (string) $request->getHeader('X-WOPI-TimeStamp');
        $proof = (string) $request->getHeader('X-WOPI-Proof');
        $proofOld = (string) $request->getHeader('X-WOPI-ProofOld');
        if (!ctype_digit($ticks) || $proof === '') {
            return false;
        }
        // .NET ticks: 100 ns since 0001-01-01.
        $sent = (intdiv((int) $ticks - 621355968000000000, 10000000));
        if (abs(time() - $sent) > self::PROOF_WINDOW) {
            return false;
        }
        // The URL the editor signed: the public site URL plus the path and query it called.
        $uri = $request->getUri();
        $site = rtrim((string) $this->config->get('siteUrl'), '/');
        $path = (string) parse_url($site, PHP_URL_PATH);
        $url = preg_replace('#' . preg_quote($path, '#') . '$#', '', $site) . $request->getServerParam('REQUEST_URI');
        $data = pack('N', strlen($token)) . $token
            . pack('N', strlen(strtoupper($url))) . strtoupper($url)
            . pack('N', 8) . pack('J', (int) $ticks);
        $current = $this->publicKey($keys['modulus'], $keys['exponent']);
        $verify = fn($key, $signature) => $key && $signature !== ''
            && openssl_verify($data, (string) base64_decode($signature), $key, OPENSSL_ALGO_SHA256) === 1;
        if ($verify($current, $proof) || $verify($current, $proofOld)) {
            return true;
        }
        if (!empty($keys['oldmodulus']) && !empty($keys['oldexponent'])) {
            return $verify($this->publicKey($keys['oldmodulus'], $keys['oldexponent']), $proof);
        }

        return false;
    }

    // ---- the person and the file ------------------------------------------------

    /**
     * Validates token and proof; returns [payload, user, attachment] or writes the refusal.
     *
     * @return ?array{0: array, 1: User, 2: Attachment}
     */
    public function enter(Request $request, Response $response): ?array
    {
        $id = (string) $request->getRouteParam('id');
        $token = (string) $request->getQueryParam('access_token');
        $payload = $this->readToken($token, $id);
        if (!$payload) {
            $response->setStatus(401);

            return null;
        }
        if (!$this->proofOk($request, $token)) {
            $GLOBALS['log']->warning("SumOffice: WOPI proof rejected for attachment $id");
            $response->setStatus(500)->writeBody('proof');

            return null;
        }
        /** @var ?User $user */
        $user = $this->entityManager->getEntityById(User::ENTITY_TYPE, $payload['u']);
        /** @var ?Attachment $attachment */
        $attachment = $this->entityManager->getEntityById(Attachment::ENTITY_TYPE, $id);
        if (!$user || !$user->isActive() || !$attachment) {
            $response->setStatus(404);

            return null;
        }
        if (!$this->aclManager->checkEntity($user, $attachment)) {
            $response->setStatus(401);

            return null;
        }

        return [$payload, $user, $attachment];
    }

    public function canWrite(User $user, Attachment $attachment): bool
    {
        $parentType = $attachment->get('parentType') ?: $attachment->get('relatedType');
        $parentId = $attachment->get('parentId') ?: $attachment->get('relatedId');
        if ($parentType && $parentId) {
            $parent = $this->entityManager->getEntityById($parentType, $parentId);

            return $parent && $this->aclManager->checkEntity($user, $parent, 'edit');
        }

        return $attachment->get('createdById') === $user->getId() || $user->isAdmin();
    }

    public function version(Attachment $attachment): string
    {
        return md5($this->fileStorageManager->getContents($attachment));
    }

    // ---- locks (one small JSON file per attachment) ------------------------------

    public function lock(string $attachmentId): ?string
    {
        $file = $this->cacheFile('lock-' . preg_replace('/[^A-Za-z0-9]/', '', $attachmentId) . '.json');
        if (!is_file($file)) {
            return null;
        }
        $lock = json_decode((string) file_get_contents($file), true);
        if (!is_array($lock) || ($lock['until'] ?? 0) < time()) {
            @unlink($file);

            return null;
        }

        return (string) $lock['id'];
    }

    public function setLock(string $attachmentId, ?string $lockId): void
    {
        $file = $this->cacheFile('lock-' . preg_replace('/[^A-Za-z0-9]/', '', $attachmentId) . '.json');
        if ($lockId === null) {
            @unlink($file);

            return;
        }
        file_put_contents($file, json_encode(['id' => $lockId, 'until' => time() + self::LOCK_TTL]), LOCK_EX);
    }

    public function write(Attachment $attachment, string $contents): void
    {
        $this->fileStorageManager->putContents($attachment, $contents);
        $attachment->set('size', strlen($contents));
        $this->entityManager->saveEntity($attachment, ['skipHooks' => true]);
    }

    public function read(Attachment $attachment): string
    {
        return $this->fileStorageManager->getContents($attachment);
    }
}
