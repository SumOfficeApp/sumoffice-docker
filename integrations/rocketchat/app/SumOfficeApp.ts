// SumOffice for Rocket.Chat -- Apps-Engine app (plain CommonJS, no build step).
//
// "Open in SumOffice" in the message menu of a message with an .xlsx, .xlsm, .xlsb or
// .docx file. The SumOffice bridge (../bridge) talks WOPI to the editor; this app is its
// only way into Rocket.Chat:
//   POST /file  -- the bridge asks for the bytes of an upload (the app reads it);
//   POST /save  -- the bridge says a new version is ready; the app fetches it from the
//                 bridge and posts it into the room as the person who edited it.
// Every call between the two is signed with the shared secret from the app settings.

import { App } from "@rocket.chat/apps-engine/definition/App";
import { ApiEndpoint, ApiVisibility, ApiSecurity } from "@rocket.chat/apps-engine/definition/api";
import { SettingType } from "@rocket.chat/apps-engine/definition/settings";
import { UIActionButtonContext } from "@rocket.chat/apps-engine/definition/ui";

// HMAC-SHA256 with no native Node modules: the marketplace refuses apps that depend
// on `crypto`. The output matches crypto.createHmac(...).digest("base64url") exactly --
// verified against Node on random inputs, including non-ASCII text.

const K: number[] = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

function sha256(bytes: number[]): number[] {
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const b = bytes.slice();
  const bitLength = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(Math.floor(bitLength / Math.pow(2, i * 8)) & 0xff);
  const w = new Array(64);
  for (let i = 0; i < b.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = (b[i+t*4]<<24) | (b[i+t*4+1]<<16) | (b[i+t*4+2]<<8) | b[i+t*4+3];
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15] >>> 3)) | 0;
      const s1 = (rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2] >>> 10)) | 0;
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
    }
    let [a,bb,c,d,e,f,g,h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  const out: number[] = [];
  for (const v of H) { out.push((v>>>24)&0xff, (v>>>16)&0xff, (v>>>8)&0xff, v&0xff); }
  return out;
}
function rotr(x: number, n: number): number { return ((x >>> n) | (x << (32 - n))) | 0; }

function toBytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of unescape(encodeURIComponent(s))) out.push(ch.charCodeAt(0) & 0xff);
  return out;
}
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i+1] ?? 0) << 8) | (bytes[i+2] ?? 0);
    s += ALPHABET[(n>>18)&63] + ALPHABET[(n>>12)&63]
       + (i+1 < bytes.length ? ALPHABET[(n>>6)&63] : "=")
       + (i+2 < bytes.length ? ALPHABET[n&63] : "=");
  }
  return s;
}
function base64url(text: string): string {
  return base64(toBytes(text)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromBase64url(s: string): string {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  let raw = "";
  for (let i = 0; i < b.length; i += 4) {
    const c = [0,1,2,3].map(k => ALPHABET.indexOf(b[i+k] ?? "="));
    const n = ((c[0] & 63) << 18) | ((c[1] & 63) << 12) | ((c[2] < 0 ? 0 : c[2]) << 6) | (c[3] < 0 ? 0 : c[3]);
    raw += String.fromCharCode((n >> 16) & 0xff);
    if (c[2] >= 0) raw += String.fromCharCode((n >> 8) & 0xff);
    if (c[3] >= 0) raw += String.fromCharCode(n & 0xff);
  }
  return decodeURIComponent(escape(raw));
}
function hmacSha256(key: string, message: string): string {
  let k = toBytes(key);
  if (k.length > 64) k = sha256(k);
  while (k.length < 64) k.push(0);
  const inner = k.map(x => x ^ 0x36).concat(toBytes(message));
  const outer = k.map(x => x ^ 0x5c).concat(sha256(inner));
  return base64(sha256(outer)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const TICKET_TTL = 300;   // seconds: the link in the dialog is opened right away
const CALL_TTL = 120;     // seconds: bridge <-> app calls

function b64(text: string) { return base64url(text); }

function mac(secret, body) {
  return hmacSha256("sumoffice-rocketchat:" + secret, body);
}

function same(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function signed(secret, payload) {
  const body = b64(JSON.stringify(payload));
  return body + "." + mac(secret, body);
}

function unsigned(secret, text) {
  const [body, sig] = String(text || "").split(".");
  if (!body || !sig || !same(sig, mac(secret, body))) return null;
  try {
    const p = JSON.parse(fromBase64url(body));
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
      id: "bridge_secret", type: SettingType.STRING, packageValue: "", required: true, public: false,
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


