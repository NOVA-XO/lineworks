/* =============================================================================
   Лиценз олгогч — ЭЗЭМШИГЧИЙН КОМПЬЮТЕР ДЭЭР ажиллана.

     node tools/issue-license.mjs --name "Бат Дорж" --org "ABC ХХК" \
          --email bat@abc.mn --mid 3F2A-91C0-7B4E-D218 [--days 30] [--edition trial|subscription|full] [--no-mail]

   2026-10-07-ноос GitHub Actions-ийн робот ХАСАГДСАН. Нийтийн Issue маягт хүсэгчийн
   нэр, байгууллага, и-мэйлийг нээлттэй вэбэд тавьж, түлхүүрийг ч мөн нийтэд бичдэг
   байв — хэн ч хуулж авах боломжтой. Одоо:

     1. Хэрэглэгч plugin-ий ZLWLICENSE цонхонд мэдээллээ бөглөж «Хүсэлт илгээх» дарна —
        хүсэлт хуулагдаж, license.html нээгдэнэ, тэнд заасан хаяг руу имэйлээр илгээнэ.
     2. Эзэмшигч энэ скриптийг ажиллуулна. Лиценз гарч, хувийн бүртгэлд орж, хүсэгч
        рүү илгээх имэйл таны имэйлийн программд бэлэн болж нээгдэнэ.

   Нууц бүгд РЕПОГИЙН ГАДНА: 00-admin/secrets/zenith-lineworks/
     private.pem  — гарын үсгийн хувийн түлхүүр (ECDSA P-256)
     data.key     — битүүмжилсэн хүснэгтийн өгөгдлийн түлхүүр (32 байт, base64)
     pepper.key   — өгөгдлийн түлхүүрийг компьютерт боох давс (32 байт, base64)
     registry.json, issued/*.lic — олгосон лицензийн хувийн бүртгэл
   Өөр газар байвал ZLW_SECRETS орчны хувьсагчаар заана.

   Хэлбэр нь plugin-ий Licensing/Core/LicenseCheck.cs-тэй ЯГ ижил байх ёстой:
     ZLW1.<b64url(payload JSON)>.<b64url(ECDSA P-256 SHA-256 IEEE-P1363 гарын үсэг)>
     payload v2 = { v, no, to, org, ed, mid, from, till, dk }
     dk = b64url(nonce12 | AES-256-GCM(kek, data.key) 32 | tag16),
     kek = HMAC-SHA256(pepper, "ZLW kek v1|" + mid + "|" + no)
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createSign, createPrivateKey, createHmac, createCipheriv, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRETS = process.env.ZLW_SECRETS
  ?? resolve(HERE, '..', '..', '..', '00-admin', 'secrets', 'zenith-lineworks');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const iso = (d) => d.toISOString().slice(0, 10);

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-mail') { out.noMail = true; continue; }
    if (!a.startsWith('--')) { fail(`Танихгүй аргумент: ${a}`); }
    out[a.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

function fail(message) {
  console.error(`АЛДАА: ${message}`);
  process.exit(2);
}

function oneLine(text, most) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, most);
}

function secret(name) {
  const path = join(SECRETS, name);
  if (!existsSync(path)) { fail(`${path} олдсонгүй.`); }
  return readFileSync(path, 'utf8');
}

function key32(name) {
  const bytes = Buffer.from(secret(name).trim(), 'base64');
  if (bytes.length !== 32) { fail(`${name} 32 байт байх ёстой.`); }
  return bytes;
}

/* --------------------------------------------------------------- оролт -- */

const a = args(process.argv.slice(2));
const person = oneLine(a.name, 80);
const org = oneLine(a.org, 80);
const email = oneLine(a.email, 120);
const mid = String(a.mid ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
const days = Number(a.days ?? 30);
const edition = a.edition ?? 'trial';

const problems = [];
if (!person) { problems.push('--name хоосон.'); }
if (!org) { problems.push('--org хоосон.'); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { problems.push('--email буруу.'); }
if (mid.length !== 16) { problems.push('--mid нь 16 оронтой hex байх ёстой (ZLWLICENSE цонхонд харагдана).'); }
if (!Number.isInteger(days) || days < 1 || days > 3660) { problems.push('--days 1–3660 бүхэл тоо.'); }
/* prime-ыг ЗӨВХӨН портал олгоно: нийт 10-ын хязгаарыг сан тоолдог, энэ хэрэгсэл тоолж чадахгүй. */
if (!['trial', 'subscription', 'full'].includes(edition)) {
  problems.push('--edition нь trial, subscription эсвэл full. Prime-ыг зөвхөн порталаар олгоно.');
}
if (problems.length) { fail(problems.join(' ')); }

/* -------------------------------------------------------------- дугаар -- */

const registryPath = join(SECRETS, 'registry.json');
const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : [];

/* Огноо нь МОНГОЛЫН календараар: plugin нь компьютерийн өөрийн огноогоор (UTC+8)
   шалгадаг. UTC-ээр бичвэл Улаанбаатарын өглөө 8-аас өмнө олгосон лиценз нэг
   өдөр хоцорч, 1 хоногийн лиценз олгогдох агшиндаа дууссан байдаг байв
   (Astra-гийн шүүлт, 2026-10-07). */
const now = new Date();
const ubDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const today = new Date(`${ubDate}T00:00:00Z`);
const year = today.getUTCFullYear();
/* Портал ZLW-<он>-<дугаар>-ыг өөрөө олгодог. Энэ нөөц хэрэгсэл L угтвартай
   (ZLW-2026-L0001) тул хоёулаа хэзээ ч ижил дугаар гаргахгүй. */
const used = registry
  .map((r) => /^ZLW-(\d{4})-L(\d+)$/.exec(r.no || ''))
  .filter((m) => m && Number(m[1]) === year)
  .map((m) => Number(m[2]));
const licenseNo = `ZLW-${year}-L${String((used.length ? Math.max(...used) : 0) + 1).padStart(4, '0')}`;
const till = new Date(today.getTime() + (days - 1) * 86400000);

/* ----------------------------------------------------------- түлхүүр -- */

const kek = createHmac('sha256', key32('pepper.key')).update(`ZLW kek v1|${mid}|${licenseNo}`, 'utf8').digest();
const nonce = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', kek, nonce);
const wrapped = Buffer.concat([cipher.update(key32('data.key')), cipher.final()]);
const dk = b64url(Buffer.concat([nonce, wrapped, cipher.getAuthTag()]));

/* Талбарын дараалал ТОГТМОЛ — гарын үсэг яг эдгээр байтыг хамарна. */
const payload = { v: 2, no: licenseNo, to: person, org, ed: edition, mid, from: iso(today), till: iso(till), dk };
const signing = `ZLW1.${b64url(JSON.stringify(payload))}`;
const signature = createSign('SHA256')
  .update(signing)
  .sign({ key: createPrivateKey(secret('private.pem')), dsaEncoding: 'ieee-p1363' });

const licenseText = [
  '-----BEGIN ZENITH LINEWORKS LICENSE-----',
  ...(`${signing}.${b64url(signature)}`.match(/.{1,64}/g) || []),
  '-----END ZENITH LINEWORKS LICENSE-----',
].join('\n');

/* ------------------------------------------------------------ бүртгэл -- */

mkdirSync(join(SECRETS, 'issued'), { recursive: true });
const licPath = join(SECRETS, 'issued', `${licenseNo}.lic`);
writeFileSync(licPath, `${licenseText}\n`, 'utf8');

registry.push({
  no: licenseNo, to: person, org, email, mid, edition, from: iso(today), till: iso(till), issued: now.toISOString(),
});
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

/* -------------------------------------------------------------- имэйл -- */

const subject = `Zenith LineWorks лиценз ${licenseNo}`;
const body = [
  `Сайн байна уу, ${person}.`,
  '',
  `Таны Zenith LineWorks лиценз ${licenseNo} бэлэн боллоо.`,
  `Хугацаа: ${iso(today)} — ${iso(till)} (${days} хоног). Компьютер: ${mid.match(/.{4}/g).join('-')}.`,
  '',
  'Civil 3D дээр ZLWLICENSE командыг ажиллуулж, доорх бичвэрийг «Лиценз оруулах» хэсэгт',
  'бүтнээр нь хуулж тавиад «Оруулах» дарна уу.',
  '',
  licenseText,
  '',
  'Энэ лиценз зөвхөн дээрх компьютер дээр ажиллана.',
  '',
  'Zenith Solar ХХК',
].join('\n');

console.log(`${licenseNo} олголоо → ${licPath}`);
console.log(`Хүсэгч: ${person} · ${org} · ${email}`);
console.log(`Хугацаа: ${iso(today)} — ${iso(till)}`);

if (!a.noMail) {
  const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  console.log('Имэйлийн программд илгээх захидал бэлэн болгож нээв. Шалгаад илгээнэ үү.');
}
