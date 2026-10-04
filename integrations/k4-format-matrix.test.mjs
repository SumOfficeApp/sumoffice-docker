import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const formats = ["xlsx", "xlsm", "xlsb", "docx", "pptx"];

test("Box, Egnyte and kintone bridges accept all three editor families", () => {
  for (const bridge of ["box", "egnyte", "kintone"]) {
    const server = read(`./${bridge}/bridge/server.mjs`);
    for (const ext of formats) assert.match(server, new RegExp(`"${ext}"`), `${bridge} misses ${ext}`);
  }
});

test("market entry surfaces expose PPTX as well as spreadsheets and documents", () => {
  const surfaces = [
    read("./box/README.md"),
    read("./egnyte/definition.json"),
    read("./kintone/plugin/manifest.json"),
    read("./kintone/plugin/js/desktop.js"),
  ];
  for (const surface of surfaces) {
    for (const ext of ["xlsx", "docx", "pptx"]) assert.match(surface, new RegExp(ext), `surface misses ${ext}`);
  }
});
