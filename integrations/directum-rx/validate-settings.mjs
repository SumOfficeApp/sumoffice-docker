const FORMATS = ["docx", "xlsx", "xlsm", "pptx"];

export function validateSettings(settings) {
  const errors = [];
  if (settings?.ENABLE_COLLABORATIVE_EDITING !== true) errors.push("ENABLE_COLLABORATIVE_EDITING должен быть true");
  const enabled = new Set(settings?.ENABLED_WEB_EDITORS ?? []);
  for (const format of FORMATS) if (!enabled.has(format)) errors.push(`не включён ${format}`);
  const editor = settings?.WEB_EDITORS?.find((item) => item?.url === "/collaboration");
  if (!editor) errors.push("нет WEB_EDITORS /collaboration");
  if (editor && !/^https:\/\//.test(String(editor.documentServerAddress ?? ""))) errors.push("адрес Сервера A4 должен быть HTTPS");
  if (editor?.jwtSecretEnvironment !== "A4_DOCUMENT_SERVER_JWT_SECRET") errors.push("JWT должен читаться из A4_DOCUMENT_SERVER_JWT_SECRET");
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const settings = JSON.parse(await new Promise((resolve) => {
    let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => resolve(input));
  }));
  const errors = validateSettings(settings);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Настройки Directum RX для Сервера A4 полные");
}

