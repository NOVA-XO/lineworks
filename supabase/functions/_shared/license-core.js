/* =============================================================================
   Лиценз гаргах цөм — WebCrypto-оор, Deno (Edge Function) ба Node (тест) хоёуланд.

   Хэлбэр нь plugin-ий Licensing/Core/LicenseCheck.cs + LicenseSecrets.cs ба
   tools/issue-license.mjs-тэй БАЙТ БҮРЭЭР ижил байх ёстой:
     ZLW1.<b64url(payload JSON)>.<b64url(ECDSA P-256 SHA-256, IEEE-P1363 64 байт)>
     payload = { v: 2, no, to, org, ed, mid, from, till, dk }  — дараалал ТОГТМОЛ
     dk  = b64url(nonce12 | AES-256-GCM(kek, dataKey) 32 | tag16)
     kek = HMAC-SHA256(pepper, "ZLW kek v1|" + mid + "|" + no)
   WebCrypto-гийн ECDSA гарын үсэг өөрөө P1363 (r||s), AES-GCM нь ct||tag буцаана.
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

export function normaliseMachineId(text) {
  return String(text ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

function oneLine(text, most) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, most);
}

/**
 * @param {{ privatePem: string, dataKeyB64: string, pepperB64: string }} secrets
 * @param {{ no: string, to: string, org: string, edition: string, mid: string, from: string, till: string }} claim
 * @returns {Promise<{ text: string, armoured: string }>}
 */
export async function issueLicense(secrets, claim) {
  const mid = normaliseMachineId(claim.mid);
  if (mid.length !== 16) { throw new Error('Компьютерийн дугаар 16 оронтой hex байх ёстой.'); }
  if (!EDITIONS.includes(claim.edition)) { throw new Error('Төрөл буруу.'); }

  const dataKey = fromBase64(secrets.dataKeyB64);
  const pepper = fromBase64(secrets.pepperB64);
  if (dataKey.length !== 32 || pepper.length !== 32) { throw new Error('Нууц түлхүүрийн урт буруу.'); }

  const hmacKey = await crypto.subtle.importKey('raw', pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kek = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(`ZLW kek v1|${mid}|${claim.no}`)));
  const aes = await crypto.subtle.importKey('raw', kek, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, dataKey));
  const blob = new Uint8Array(60);
  blob.set(nonce, 0);
  blob.set(sealed, 12);

  const payload = {
    v: 2,
    no: claim.no,
    to: oneLine(claim.to, 80),
    org: oneLine(claim.org, 80),
    ed: claim.edition,
    mid,
    from: claim.from,
    till: claim.till,
    dk: b64url(blob),
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
  return { text, armoured };
}
