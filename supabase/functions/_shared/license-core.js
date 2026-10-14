/* =============================================================================
   Лиценз гаргах цөм — WebCrypto-оор, Deno (Edge Function) ба Node (тест) хоёуланд.

   Хэлбэр нь plugin-ий Licensing/Core/LicenseCheck.cs + MachineIdentity.cs ба
   tools/issue-license.mjs-тэй БАЙТ БҮРЭЭР ижил байх ёстой:
     ZLW1.<b64url(payload JSON)>.<b64url(ECDSA P-256 SHA-256, IEEE-P1363 64 байт)>
     payload = { v: 3, no, to, org, ed, mid, from, till, dk }  — дараалал ТОГТМОЛ
     dk  = b64url(RSA-OAEP-SHA256(компьютерийн TPM түлхүүр, dataKey))
     mid = hex(SHA-256("ZLW-MID-3|" || SPKI))[0..16], том үсгээр
   Компьютерийн TPM түлхүүр хүсэлтийн кодоор ирнэ: "ZLWK1." + b64url(SPKI).

   v3 (2026-10-14): өгөгдлийн түлхүүрийг компьютерийн TPM-ийн гаргаж авах боломжгүй
   түлхүүрээр шифрлэнэ — зөвхөн тэр чип тайлна. v2 нь plugin-д бичигдсэн pepper-ээр
   боодог байсан тул лицензийн файл + DLL байхад аль ч компьютер дээр нээгддэг байв.
   ========================================================================== */

const enc = new TextEncoder();

/* trial — админ хоног сонгоно; subscription — 365 хоног; prime — хугацаагүй (нийт 10,
   сан мөрдүүлнэ); full — 2026-10-07-ноос өмнө олгосон, шинээр олгохгүй. */
export const EDITIONS = ['trial', 'subscription', 'prime', 'full'];
export const PERPETUAL_UNTIL = '9999-12-31';
export const SUBSCRIPTION_DAYS = 365;

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) { s += String.fromCharCode(b); }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64(text) {
  const raw = atob(text.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) { out[i] = raw.charCodeAt(i); }
  return out;
}

function pemBody(pem) {
  return fromBase64(pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, ''));
}

/* Монголын календарийн огноо (Asia/Ulaanbaatar), yyyy-mm-dd. plugin нь компьютерийн
   өөрийн огноогоор шалгадаг тул UTC-ээр бичвэл өглөө 8-аас өмнө нэг өдөр алдана. */
export function ulaanbaatarDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
}

/* Лицензийн дугаар САНАМСАРГҮЙ (эзэн, 2026-10-08: «таахад хялбар байна»). Өмнө нь
   ZLW-2026-0001, 0002… дараалсан тул олгосон лицензийн тоо, дараагийн дугаар нь
   ил байв. Одоо ZLW-XXXX-XXXX-XXXX-XXXX: криптографийн санамсаргүй 16 тэмдэгт,
   Crockford base32 (I, L, O, U байхгүй — 1/I, 0/O андуурагдахгүй), 80 бит.
   32 нь 256-г яг хуваадаг тул `% 32` хазайлтгүй. Лицензийг хамгаалдаг нь дугаар
   биш гарын үсэг; дугаар нь зөвхөн таамаглагдах, тоологдохгүй байх ёстой. */
export const LICENSE_NO_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LICENSE_NO_PATTERN = /^ZLW(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;

export function newLicenseNo() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => LICENSE_NO_ALPHABET[b % 32]).join('');
  return `ZLW-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

export function fromB64url(text) {
  const standard = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
}

export const REQUEST_PREFIX = 'ZLWK1';

/* Хүсэлтийн кодоос компьютерийн нийтийн түлхүүр (SPKI).
   CANONICAL OR NOTHING (Astra, 2026-10-14) — plugin-ий MachineIdentity.TryParseRequestCode-тэй яг
   ижил кодыг л хүлээн авна, эс бөгөөс нэг түлхүүр хоёр дугаартай болно:
     - зөвхөн space, tab, CR, LF-ийг хаяна;
     - бие нь padding-гүй base64url, 1–1400 тэмдэгт, дахин кодлоход өөртэйгөө тэнцэнэ;
     - DER бүрэн уншигдана (экспортлоход яг ижил байт буцна — илүүдэл байт байхгүй);
     - түлхүүр нь яг RSA-2048, e = 65537 (TpmMachineKey-ийн үүсгэдэг хэлбэр). */
export const MAX_REQUEST_BODY = 1400;

export async function parseRequestCode(code) {
  const bad = 'Хүсэлтийн код буруу байна — ZLWLICENSE цонхноос бүтнээр нь хуулна уу.';
  const bare = String(code ?? '').replace(/[ \t\r\n]+/g, '');
  const parts = bare.split('.');
  if (parts.length !== 2 || parts[0] !== REQUEST_PREFIX
      || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || parts[1].length > MAX_REQUEST_BODY) {
    throw new Error(bad);
  }
  let spki;
  let key;
  try {
    spki = fromB64url(parts[1]);
    key = await crypto.subtle.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
  } catch {
    throw new Error(bad);
  }
  const exported = new Uint8Array(await crypto.subtle.exportKey('spki', key));
  if (b64url(spki) !== parts[1] || b64url(exported) !== parts[1]) { throw new Error(bad); }
  const e = key.algorithm.publicExponent;
  if (key.algorithm.modulusLength !== 2048 || e.length !== 3 || e[0] !== 1 || e[1] !== 0 || e[2] !== 1) {
    throw new Error('Компьютерийн түлхүүр хүлээгдсэн хэлбэрийнх биш (RSA-2048) байна.');
  }
  return { spki, key, body: parts[1], machineId: await machineIdFromKey(spki) };
}

/* Компьютерийн дугаар = SHA-256("ZLW-MID-3|" || SPKI)-ийн эхний 8 байт, hex. */
export async function machineIdFromKey(spki) {
  const label = enc.encode('ZLW-MID-3|');
  const input = new Uint8Array(label.length + spki.length);
  input.set(label, 0);
  input.set(spki, label.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function normaliseMachineId(text) {
  return String(text ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

function oneLine(text, most) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, most);
}

/**
 * @param {{ privatePem: string, dataKeyB64: string }} secrets
 * @param {{ no: string, to: string, org: string, edition: string, requestCode: string, mid?: string, from: string, till: string }} claim
 *   mid, when given, must equal the fingerprint of the request code's key — the identifier the
 *   user saw and the key the licence is encrypted to cannot be two different computers.
 * @returns {Promise<{ text: string, armoured: string, mid: string }>}
 */
export async function issueLicense(secrets, claim) {
  if (!EDITIONS.includes(claim.edition)) { throw new Error('Төрөл буруу.'); }
  const { key: machineKey, machineId: mid } = await parseRequestCode(claim.requestCode);
  if (claim.mid != null && normaliseMachineId(claim.mid) !== mid) {
    throw new Error('Компьютерийн дугаар хүсэлтийн кодтой таарахгүй байна.');
  }

  const dataKey = fromBase64(secrets.dataKeyB64);
  if (dataKey.length !== 32) { throw new Error('Нууц түлхүүрийн урт буруу.'); }
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, machineKey, dataKey));

  const payload = {
    v: 3,
    no: claim.no,
    to: oneLine(claim.to, 80),
    org: oneLine(claim.org, 80),
    ed: claim.edition,
    mid,
    from: claim.from,
    till: claim.till,
    dk: b64url(sealed),
  };

  const signing = `ZLW1.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemBody(secrets.privatePem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signing));
  if (signature.byteLength !== 64) { throw new Error('Гарын үсгийн хэлбэр буруу.'); }

  const text = `${signing}.${b64url(signature)}`;
  const armoured = [
    '-----BEGIN ZENITH LINEWORKS LICENSE-----',
    ...(text.match(/.{1,64}/g) || []),
    '-----END ZENITH LINEWORKS LICENSE-----',
  ].join('\n');
  return { text, armoured, mid };
}
