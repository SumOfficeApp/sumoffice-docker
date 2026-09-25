<?php
/*
 * SumOffice for SuiteCRM — WOPI host helper.
 *
 * SuiteCRM is the WOPI host (storage), SumOffice is the WOPI client (editor).
 * The file is a Document revision (upload/<revision id>). Everything the editor
 * calls back runs with the rights of the person who opened it: the token carries
 * their user id, and access goes through SuiteCRM's ACL for the Document.
 */
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

class SumOfficeWopi
{
    public const EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'docx'];
    private const TOKEN_TTL = 36000;
    private const LOCK_TTL = 1800;        // MS-WOPI: 30 minutes
    private const PROOF_WINDOW = 1200;    // MS-WOPI: 20 minutes of clock skew
    private const DISCOVERY_TTL = 3600;

    public static function conf(string $key, $default = null)
    {
        global $sugar_config;

        return $sugar_config[$key] ?? $default;
    }

    public static function siteUrl(): string
    {
        return rtrim((string) self::conf('site_url'), '/');
    }

    // ---- token ----------------------------------------------------------------

    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function secret(): string
    {
        return 'sumoffice-wopi:' . self::conf('unique_key', '');
    }

    public static function makeToken(string $userId, string $revisionId, bool $canWrite): array
    {
        $expires = time() + self::TOKEN_TTL;
        $body = self::b64(json_encode(['u' => $userId, 'r' => $revisionId, 'w' => $canWrite, 'e' => $expires]));

        return [$body . '.' . self::b64(hash_hmac('sha256', $body, self::secret(), true)), $expires];
    }

    public static function readToken(string $token, string $revisionId): ?array
    {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2 || !hash_equals(self::b64(hash_hmac('sha256', $parts[0], self::secret(), true)), $parts[1])) {
            return null;
        }
        $payload = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/')), true);
        if (!is_array($payload) || ($payload['r'] ?? null) !== $revisionId || ($payload['e'] ?? 0) < time()) {
            return null;
        }

        return $payload;
    }

    // ---- discovery and proof keys ---------------------------------------------

    private static function cacheFile(string $name): string
    {
        $dir = sugar_cached('sumoffice');
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        return $dir . '/' . $name;
    }

    public static function discovery(): ?array
    {
        $url = self::conf('sumoffice_discovery_url');
        if (!$url) {
            return null;
        }
        $file = self::cacheFile('discovery.json');
        if (is_file($file) && time() - filemtime($file) < self::DISCOVERY_TTL) {
            $cached = json_decode((string) file_get_contents($file), true);
            if (is_array($cached) && ($cached['url'] ?? null) === $url) {
                return $cached;
            }
        }
        $ca = self::conf('sumoffice_ca_bundle');
        $context = stream_context_create(['http' => ['timeout' => 15], 'ssl' => $ca ? ['cafile' => $ca, 'verify_peer' => true] : ['verify_peer' => true]]);
        $xml = @file_get_contents($url, false, $context);
        $doc = $xml === false ? false : @simplexml_load_string($xml);
        if (!$doc) {
            return null;
        }
        $actions = [];
        foreach ($doc->xpath('//action') ?: [] as $action) {
            $ext = strtolower((string) $action['ext']);
            $name = (string) $action['name'];
            $src = (string) $action['urlsrc'];
            if ($ext && $name && $src && !isset($actions["$ext|$name"])) {
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

    private static function derLength(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }
        $bytes = ltrim(pack('N', $length), "\0");

        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    private static function derInteger(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ($bytes === '' || ord($bytes[0]) & 0x80) {
            $bytes = "\0" . $bytes;
        }

        return "\x02" . self::derLength(strlen($bytes)) . $bytes;
    }

    private static function publicKey(string $modulus, string $exponent)
    {
        $rsa = self::derInteger(base64_decode($modulus)) . self::derInteger(base64_decode($exponent));
        $rsa = "\x30" . self::derLength(strlen($rsa)) . $rsa;
        $bits = "\x03" . self::derLength(strlen($rsa) + 1) . "\0" . $rsa;
        $alg = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
        $spki = "\x30" . self::derLength(strlen($alg . $bits)) . $alg . $bits;

        return openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n");
    }

    public static function proofOk(string $token): bool
    {
        if (self::conf('sumoffice_verify_proof', true) === false) {
            return true;
        }
        $keys = self::discovery()['proof'] ?? null;
        if (!$keys || empty($keys['modulus'])) {
            return false;
        }
        $ticks = (string) ($_SERVER['HTTP_X_WOPI_TIMESTAMP'] ?? '');
        $proof = (string) ($_SERVER['HTTP_X_WOPI_PROOF'] ?? '');
        $proofOld = (string) ($_SERVER['HTTP_X_WOPI_PROOFOLD'] ?? '');
        if (!ctype_digit($ticks) || $proof === '') {
            return false;
        }
        if (abs(time() - intdiv((int) $ticks - 621355968000000000, 10000000)) > self::PROOF_WINDOW) {
            return false;
        }
        $site = self::siteUrl();
        $url = preg_replace('#^(https?://[^/]+).*$#', '$1', $site) . $_SERVER['REQUEST_URI'];
        $data = pack('N', strlen($token)) . $token . pack('N', strlen(strtoupper($url))) . strtoupper($url) . pack('N', 8) . pack('J', (int) $ticks);
        $verify = function ($key, $signature) use ($data) {
            return $key && $signature !== '' && openssl_verify($data, (string) base64_decode($signature), $key, OPENSSL_ALGO_SHA256) === 1;
        };
        $current = self::publicKey($keys['modulus'], $keys['exponent']);
        if ($verify($current, $proof) || $verify($current, $proofOld)) {
            return true;
        }
        if (!empty($keys['oldmodulus']) && !empty($keys['oldexponent'])) {
            return $verify(self::publicKey($keys['oldmodulus'], $keys['oldexponent']), $proof);
        }

        return false;
    }

    // ---- the file and the person ------------------------------------------------

    /** @return array{0: DocumentRevision, 1: Document}|null */
    public static function load(string $revisionId): ?array
    {
        $revision = BeanFactory::getBean('DocumentRevisions', $revisionId);
        if (!$revision || empty($revision->id) || empty($revision->document_id)) {
            return null;
        }
        $document = BeanFactory::getBean('Documents', $revision->document_id);
        if (!$document || empty($document->id)) {
            return null;
        }

        return [$revision, $document];
    }

    public static function path(string $revisionId): string
    {
        return rtrim((string) self::conf('upload_dir', 'upload/'), '/') . '/' . preg_replace('/[^A-Za-z0-9-]/', '', $revisionId);
    }

    public static function canRead($document): bool
    {
        return (bool) $document->ACLAccess('view');
    }

    public static function canWrite($document): bool
    {
        return (bool) $document->ACLAccess('edit');
    }

    // ---- locks ------------------------------------------------------------------

    private static function lockFile(string $revisionId): string
    {
        return self::cacheFile('lock-' . preg_replace('/[^A-Za-z0-9-]/', '', $revisionId) . '.json');
    }

    public static function lock(string $revisionId): ?string
    {
        $file = self::lockFile($revisionId);
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

    public static function setLock(string $revisionId, ?string $lockId): void
    {
        $file = self::lockFile($revisionId);
        if ($lockId === null) {
            @unlink($file);

            return;
        }
        file_put_contents($file, json_encode(['id' => $lockId, 'until' => time() + self::LOCK_TTL]), LOCK_EX);
    }
}
