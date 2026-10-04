import test from "node:test";
import assert from "node:assert/strict";
import { replaceTrackerAttachment } from "../attachment-action.mjs";

test("saved file replaces the original Tracker attachment", async () => {
  let upload; let closed;
  const data = { id: "new-attachment" };
  const trackerApi = { v3: { post: { "/attachments": async (value) => (upload = value, { data }) } } };
  const hostApi = { close: (value) => { closed = value; } };
  assert.equal(await replaceTrackerAttachment({ trackerApi, hostApi, blob: new Blob(["x"]), filename: "work.xlsm" }), data);
  assert.equal(upload.bodyParams.filename, "work.xlsm");
  assert.equal(upload.file.name, "work.xlsm");
  assert.deepEqual(closed, { attachments: [data], replace: true });
});

