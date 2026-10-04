import { openAttachmentSession, requireOfficeName } from "../a4-attachment-core/attachment.mjs";

export function officeFiles(files) {
  return (files ?? []).filter((file) => {
    try { requireOfficeName(file.name); return true; } catch { return false; }
  });
}

export async function beginKaitenEdit({ api, cardUid, file, sessionEndpoint, fetchImpl = fetch }) {
  requireOfficeName(file.name);
  const metadata = await api.get(`/api/v1/cards/${cardUid}/files/${file.id}`);
  if (!metadata?.url) throw new Error("Kaiten не вернул временную ссылку файла");
  const downloaded = await fetchImpl(metadata.url, { redirect: "follow", credentials: "omit" });
  if (!downloaded.ok) throw new Error(`Kaiten не отдал файл: HTTP ${downloaded.status}`);
  return openAttachmentSession({
    endpoint: sessionEndpoint,
    blob: await downloaded.blob(),
    name: file.name,
    source: "kaiten",
    fetchImpl,
  });
}

export async function returnKaitenFile({ api, cardUid, originalFileId, blob, filename }) {
  requireOfficeName(filename);
  const form = new FormData();
  form.set("file", new File([blob], filename, { type: blob.type || "application/octet-stream" }));
  const created = await api.post(`/api/v1/cards/${cardUid}/files`, form);
  if (!created?.id) throw new Error("Kaiten не вернул новое вложение");
  try {
    await api.delete(`/api/v1/cards/${cardUid}/files/${originalFileId}`);
  } catch (error) {
    throw new AggregateError([error], "Новая версия загружена, но исходное вложение не удалено");
  }
  return created;
}

