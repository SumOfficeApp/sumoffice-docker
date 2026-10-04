import test from "node:test";
import assert from "node:assert/strict";
import { officeFiles, returnKaitenFile } from "../addon.mjs";

test("card action shows only the four office formats", () => {
  assert.deepEqual(officeFiles([{ name: "a.xlsx" }, { name: "a.docx" }, { name: "a.pptx" }, { name: "a.xlsm" }, { name: "a.pdf" }]).map((x) => x.name), ["a.xlsx", "a.docx", "a.pptx", "a.xlsm"]);
});

test("restricted file replacement uploads by card uid before deleting the old file", async () => {
  const calls = [];
  const api = {
    post: async (path, form) => (calls.push(["post", path, form.get("file").name]), { id: "new" }),
    delete: async (path) => { calls.push(["delete", path]); },
  };
  const result = await returnKaitenFile({ api, cardUid: "card-uuid", originalFileId: "old-uuid", blob: new Blob(["x"]), filename: "a.pptx" });
  assert.equal(result.id, "new");
  assert.deepEqual(calls, [
    ["post", "/api/v1/cards/card-uuid/files", "a.pptx"],
    ["delete", "/api/v1/cards/card-uuid/files/old-uuid"],
  ]);
});

