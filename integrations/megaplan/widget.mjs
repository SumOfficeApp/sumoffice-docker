import { requireOfficeName } from "../a4-attachment-core/attachment.mjs";

export function userCheckUrl(accountBase, applicationUuid, userSign) {
  const url = new URL("/BumsSettingsApiV01/Application/checkUserSign.json", accountBase);
  url.searchParams.set("uuid", String(applicationUuid));
  url.searchParams.set("userSign", String(userSign));
  return url.toString();
}

export async function uploadEditedFile({ accountBase, fetchImpl = fetch, blob, filename, headers = {} }) {
  requireOfficeName(filename);
  const form = new FormData();
  form.set("files[]", new File([blob], filename, { type: blob.type || "application/octet-stream" }));
  const response = await fetchImpl(new URL("/api/file", accountBase), { method: "POST", headers, body: form });
  if (!response.ok) throw new Error(`Мегаплан не принял файл: HTTP ${response.status}`);
  const body = await response.json();
  const file = body?.data?.files?.[0] ?? body?.data?.[0] ?? body?.files?.[0];
  if (!file?.id) throw new Error("Мегаплан не вернул идентификатор файла");
  return file;
}

