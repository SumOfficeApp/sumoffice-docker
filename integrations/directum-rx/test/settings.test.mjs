import test from "node:test";
import assert from "node:assert/strict";
import settings from "../settings.example.json" with { type: "json" };
import { validateSettings } from "../validate-settings.mjs";

test("example enables all three editors and keeps JWT outside the file", () => {
  assert.deepEqual(validateSettings(settings), []);
  assert.equal(JSON.stringify(settings).includes("secret"), false);
});

test("missing presentations and insecure server fail closed", () => {
  const broken = structuredClone(settings);
  broken.ENABLED_WEB_EDITORS = ["docx", "xlsx", "xlsm"];
  broken.WEB_EDITORS[0].documentServerAddress = "http://a4.invalid";
  assert.deepEqual(validateSettings(broken), ["не включён pptx", "адрес Сервера A4 должен быть HTTPS"]);
});

