import test from "node:test";
import assert from "node:assert/strict";
import { officeExtension, openAttachmentSession, requireOfficeName } from "../attachment.mjs";

test("four office formats are accepted and executable names are rejected", () => {
  for (const name of ["a.xlsx", "a.XLSM", "a.docx", "a.pptx"]) assert.equal(requireOfficeName(name), name);
  assert.equal(officeExtension("book.XLSM"), "xlsm");
  assert.throws(() => requireOfficeName("payload.html"), /XLSX/);
  assert.throws(() => requireOfficeName("no-extension"), /XLSX/);
});

test("session upload is multipart and requires an https editor URL", async () => {
  let request;
  const session = await openAttachmentSession({
    endpoint: "https://a4.example/session",
    blob: new Blob(["book"]),
    name: "book.xlsx",
    source: "test",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ id: "s1", editorUrl: "https://a4.example/edit/s1" }), { status: 200 });
    },
  });
  assert.equal(session.id, "s1");
  assert.equal(request.url, "https://a4.example/session");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.credentials, "include");
  assert.equal(request.init.body.get("source"), "test");
  assert.equal(request.init.body.get("file").name, "book.xlsx");
});

