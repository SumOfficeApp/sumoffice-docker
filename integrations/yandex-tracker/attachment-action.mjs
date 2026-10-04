import { openAttachmentSession, requireOfficeName } from "../a4-attachment-core/attachment.mjs";

export async function beginTrackerEdit({ slotContext, filename, sessionEndpoint, fetchImpl }) {
  requireOfficeName(filename);
  return openAttachmentSession({
    endpoint: sessionEndpoint,
    blob: slotContext.attachmentBlob,
    name: filename,
    source: "yandex-tracker",
    fetchImpl,
  });
}

export async function replaceTrackerAttachment({ trackerApi, hostApi, blob, filename }) {
  requireOfficeName(filename);
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  const response = await trackerApi.v3.post["/attachments"]({ bodyParams: { filename }, file });
  if (!response?.data) throw new Error("Трекер не вернул созданное вложение");
  hostApi.close({ attachments: [response.data], replace: true });
  return response.data;
}

