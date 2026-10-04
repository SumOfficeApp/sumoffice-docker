import test from "node:test";
import assert from "node:assert/strict";
import { uploadEditedFile, userCheckUrl } from "../widget.mjs";

test("iframe user signature is checked against the account that opened it", () => {
  const url = new URL(userCheckUrl("https://demo.megaplan.ru", "app-1", "sig-1"));
  assert.equal(url.origin, "https://demo.megaplan.ru");
  assert.equal(url.searchParams.get("uuid"), "app-1");
  assert.equal(url.searchParams.get("userSign"), "sig-1");
});

test("edited file is uploaded through the current API file endpoint", async () => {
  let seen;
  const file = await uploadEditedFile({
    accountBase: "https://demo.megaplan.ru",
    blob: new Blob(["x"]),
    filename: "deal.docx",
    fetchImpl: async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ data: { files: [{ id: "f1" }] } }), { status: 200 });
    },
  });
  assert.equal(file.id, "f1");
  assert.equal(seen.url, "https://demo.megaplan.ru/api/file");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.body.get("files[]").name, "deal.docx");
});

