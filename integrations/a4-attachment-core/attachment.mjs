const EXTENSIONS = new Set(["xlsx", "xlsm", "docx", "pptx"]);

export function officeExtension(name) {
  const value = String(name ?? "").trim();
  const dot = value.lastIndexOf(".");
  return dot < 1 ? "" : value.slice(dot + 1).toLowerCase();
}

export function requireOfficeName(name) {
  const value = String(name ?? "").trim();
  if (!EXTENSIONS.has(officeExtension(value))) {
    throw new TypeError("Поддерживаются только XLSX, XLSM, DOCX и PPTX");
  }
  return value;
}

export async function openAttachmentSession({ endpoint, blob, name, source, fetchImpl = fetch }) {
  requireOfficeName(name);
  if (!(blob instanceof Blob)) throw new TypeError("Файл должен быть Blob");
  const form = new FormData();
  form.set("file", new File([blob], name, { type: blob.type || "application/octet-stream" }));
  form.set("source", String(source));
  const response = await fetchImpl(endpoint, { method: "POST", body: form, credentials: "include" });
  if (!response.ok) throw new Error(`Сервер A4 не создал сеанс: HTTP ${response.status}`);
  const session = await response.json();
  if (!/^https:\/\//.test(String(session.editorUrl ?? "")) || !String(session.id ?? "")) {
    throw new Error("Сервер A4 вернул неполный сеанс");
  }
  return session;
}

