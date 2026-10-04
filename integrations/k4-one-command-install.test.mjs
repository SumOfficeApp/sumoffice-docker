import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cases = [
  ["box", "sumoffice-box-bridge", "8796:8796"],
  ["egnyte", "sumoffice-egnyte-bridge", "8790:8790"],
  ["kintone", "sumoffice-kintone-bridge", "8787:8787"],
];

for (const [channel, image, port] of cases) {
  test(`${channel} installs with one command and an env file`, () => {
    const sandbox = mkdtempSync(join(tmpdir(), `sumoffice-${channel}-install-`));
    const bin = join(sandbox, "bin");
    const log = join(sandbox, "docker.log");
    const envFile = join(sandbox, `${channel}.env`);
    const mkdir = spawnSync("mkdir", ["-p", bin]);
    assert.equal(mkdir.status, 0);
    const docker = join(bin, "docker");
    writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_LOG"\n');
    chmodSync(docker, 0o755);
    writeFileSync(envFile, "TOKEN_KEY=not-a-real-secret\n");

    const result = spawnSync(`integrations/${channel}/install.sh`, [envFile], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, new RegExp(`build -t ${image} `));
    assert.match(calls, new RegExp(`rm -f ${image}`));
    assert.match(calls, new RegExp(`run -d --restart unless-stopped --name ${image} -p ${port} --env-file `));
  });
}
