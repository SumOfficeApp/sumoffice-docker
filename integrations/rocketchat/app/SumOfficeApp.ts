// SumOffice for Rocket.Chat — Apps-Engine app (plain CommonJS, no build step).
//
// "Open in SumOffice" in the message menu of a message with an .xlsx, .xlsm, .xlsb or
// .docx file. The SumOffice bridge (../bridge) talks WOPI to the editor; this app is its
// only way into Rocket.Chat:
//   POST /file  — the bridge asks for the bytes of an upload (the app reads it);
//   POST /save  — the bridge says a new version is ready; the app fetches it from the
//                 bridge and posts it into the room as the person who edited it.
// Every call between the two is signed with the shared secret from the app settings.

import { App } from "@rocket.chat/apps-engine/definition/App";
import { ApiEndpoint, ApiVisibility, ApiSecurity } from "@rocket.chat/apps-engine/definition/api";
import { SettingType } from "@rocket.chat/apps-engine/definition/settings";
import { UIActionButtonContext } from "@rocket.chat/apps-engine/definition/ui";
import * as crypto from "crypto";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const TICKET_TTL = 300;   // seconds: the link in the dialog is opened right away
const CALL_TTL = 120;     // seconds: bridge ↔ app calls

function b64(text) { return Buffer.from(text).toString("base64url"); }

function mac(secret, body) {
  return crypto.createHmac("sha256", "sumoffice-rocketchat:" + secret).update(body).digest("base64url");
}

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function signed(secret, payload) {
  const body = b64(JSON.stringify(payload));
  return body + "." + mac(secret, body);
}

function unsigned(secret, text) {
  const [body, sig] = String(text || "").split(".");
  if (!body || !sig || !same(sig, mac(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.e > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}

async function settings(read) {
  const env = read.getEnvironmentReader().getSettings();
  return {
    bridgeUrl: String((await env.getValueById("bridge_url")) || "").replace(/\/+$/, ""),
    secret: String((await env.getValueById("bridge_secret")) || ""),
  };
}

function ext(name) {
  const i = String(name).lastIndexOf(".");
  return i < 0 ? "" : String(name).slice(i + 1).toLowerCase();
}

class FileEndpoint extends ApiEndpoint {
  constructor(app) { super(app); this.path = "file"; }

  async post(request, endpoint, read) {
    const { secret } = await settings(read);
    const p = unsigned(secret, request.content && request.content.call);
    if (!secret || !p || p.op !== "file") return { status: 401 };
    const upload = await read.getUploadReader().getById(p.f);
    if (!upload || !upload.room || upload.room.id !== p.r) return { status: 404 };
    const data = await read.getUploadReader().getBuffer(upload);
    return { status: 200, content: { name: upload.name, size: data.length, type: upload.type, data: Buffer.from(data).toString("base64") } };
  }
}

class SaveEndpoint extends ApiEndpoint {
  constructor(app) { super(app); this.path = "save"; }

  async post(request, endpoint, read, modify, http) {
    const { bridgeUrl, secret } = await settings(read);
    const p = unsigned(secret, request.content && request.content.call);
    if (!secret || !p || p.op !== "save") return { status: 401 };
    const room = await read.getRoomReader().getById(p.r);
    const user = await read.getUserReader().getByUsername(p.u);
    if (!room || !user) return { status: 404 };
    const members = await read.getRoomReader().getMembers(room.id);
    if (!members.some((m) => m.id === user.id)) return { status: 403 };
    // Fetch the new version from the bridge: Rocket.Chat accepts only small JSON bodies
    // on app endpoints, so the file itself never travels in this request.
    const call = signed(secret, { op: "pending", k: p.k, e: Math.floor(Date.now() / 1000) + CALL_TTL });
    const res = await http.post(bridgeUrl + "/rocketchat/pending", { data: { call }, timeout: 60000 });
    if (!res || res.statusCode !== 200) return { status: 502, content: { error: "bridge: " + (res && res.statusCode) } };
    const body = typeof res.content === "string" ? JSON.parse(res.content) : res.data || res.content;
    const upload = await modify.getCreator().getUploadCreator().uploadBuffer(Buffer.from(body.data, "base64"), { filename: p.n, room, user });
    return { status: 200, content: { fileId: upload.id } };
  }
}

export class SumOfficeApp extends App {
  async extendConfiguration(configuration) {
    await configuration.settings.provideSetting({
      id: "bridge_url", type: SettingType.STRING, packageValue: "", required: true, public: false,
      i18nLabel: "bridge_url_label", i18nDescription: "bridge_url_description",
    });
    await configuration.settings.provideSetting({
      id: "bridge_secret", type: SettingType.PASSWORD, packageValue: "", required: true, public: false,
      i18nLabel: "bridge_secret_label", i18nDescription: "bridge_secret_description",
    });
    await configuration.api.provideApi({
      visibility: ApiVisibility.PUBLIC,
      security: ApiSecurity.UNSECURE, // every call carries a signature made with the shared secret
      endpoints: [new FileEndpoint(this), new SaveEndpoint(this)],
    });
    configuration.ui.registerButton({ actionId: "sumoffice-open", labelI18n: "open_in_sumoffice", context: UIActionButtonContext.MESSAGE_ACTION });
  }

  // The dialog's button is a plain link; Rocket.Chat still reports the click to the app
  // and opens the link once the app answers.
  async executeBlockActionHandler(context) {
    return context.getInteractionResponder().successResponse();
  }

  async executeActionButtonHandler(context, read) {
    const data = context.getInteractionData();
    const responder = context.getInteractionResponder();
    const file = data.message && data.message.file;
    const say = (text: string, blocks?: any) => responder.openModalViewResponse({
      title: { type: "plain_text", text: "SumOffice" },
      blocks: [{ type: "section", text: { type: "plain_text", text } }].concat(blocks || []),
    });
    if (!file || EXTENSIONS.indexOf(ext(file.name)) < 0) return say("SumOffice opens .xlsx, .xlsm, .xlsb and .docx files.");
    const { bridgeUrl, secret } = await settings(read);
    if (!bridgeUrl || secret.length < 16) return say("SumOffice is not set up yet: an administrator fills in the bridge URL and secret in the app settings.");
    const room = data.room;
    const user = data.user;
    // Write access: the person can post in the room (read-only rooms open read-only).
    const canWrite = !room.isReadOnly;
    const ticket = signed(secret, {
      op: "open", f: file._id, n: file.name, r: room.id, m: data.message.id,
      u: user.username, un: user.name || user.username, w: canWrite, e: Math.floor(Date.now() / 1000) + TICKET_TTL,
    });
    return say(file.name, [{
      type: "actions",
      blockId: "sumoffice-open",
      elements: [{
        type: "button", actionId: "sumoffice-open-link", appId: this.getID(), blockId: "sumoffice-open",
        style: "primary", text: { type: "plain_text", text: canWrite ? "Open in SumOffice" : "Open in SumOffice (read-only)" },
        url: bridgeUrl + "/rocketchat/open?t=" + encodeURIComponent(ticket),
      }],
    }]);
  }
}


