/* =============================================================================
   Лиценз олгогч — ЭЗЭМШИГЧИЙН КОМПЬЮТЕР ДЭЭР ажиллана.

     node tools/issue-license.mjs --name "Бат Дорж" --org "ABC ХХК" \
          --email bat@abc.mn --code "ZLWK1.…" [--days 30] [--edition trial|subscription] [--no-mail]

   --code нь хэрэглэгчийн ZLWLICENSE (эсвэл суулгагч)-ийн «Хүсэлтийн код» — компьютерийн
   TPM-ийн нийтийн түлхүүр. Лиценз v3 (2026-10-14): өгөгдлийн түлхүүр тэр түлхүүрээр
   шифрлэгдэнэ. Хэлбэр, шифрлэлт бүхэлдээ supabase/functions/_shared/license-core.js-д —
   портал ба энэ хэрэгсэл нэг кодоор олгоно.

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
     registry.json, issued/*.lic — олгосон лицензийн хувийн бүртгэл
   Өөр газар байвал ZLW_SECRETS орчны хувьсагчаар заана.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { newLicenseNo, issueLicense, parseRequestCode } from '../supabase/functions/_shared/license-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRETS = process.env.ZLW_SECRETS
  ?? resolve(HERE, '..', '..', '..', '00-admin', 'secrets', 'zenith-lineworks');

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


/* --------------------------------------------------------------- оролт -- */

const a = args(process.argv.slice(2));
const person = oneLine(a.name, 80);
const org = oneLine(a.org, 80);
const email = oneLine(a.email, 120);
let machine;
try {
  machine = await parseRequestCode(a.code);
} catch (e) {
  fail(`--code: ${e.message}`);
}
const mid = machine.machineId;
const days = Number(a.days ?? 30);
const edition = a.edition ?? 'trial';

const problems = [];
if (!person) { problems.push('--name хоосон.'); }
if (!org) { problems.push('--org хоосон.'); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { problems.push('--email буруу.'); }
if (!Number.isInteger(days) || days < 1 || days > 3660) { problems.push('--days 1–3660 бүхэл тоо.'); }
/* prime-ыг ЗӨВХӨН портал олгоно: нийт 10-ын хязгаарыг сан тоолдог, энэ хэрэгсэл тоолж чадахгүй.
   full нь 2026-10-07-ноос өмнөх лицензийнх — шинээр олгохгүй (2026-10-14). */
if (!['trial', 'subscription'].includes(edition)) {
  problems.push('--edition нь trial эсвэл subscription. Prime-ыг зөвхөн порталаар олгоно.');
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
/* Дугаар САНАМСАРГҮЙ, порталтай ижил үүсгэгчээр (2026-10-08). Хувийн бүртгэлд
   байгаа дугаартай давхцвал дахин үүсгэнэ — 80 битэд бараг боломжгүй ч. */
const known = new Set(registry.map((r) => r.no));
let licenseNo = newLicenseNo();
while (known.has(licenseNo)) { licenseNo = newLicenseNo(); }
const till = new Date(today.getTime() + (days - 1) * 86400000);

/* ----------------------------------------------------------- лиценз -- */

const { armoured: licenseText } = await issueLicense(
  { privatePem: secret('private.pem'), dataKeyB64: secret('data.key').trim() },
  { no: licenseNo, to: person, org, edition, requestCode: a.code, from: iso(today), till: iso(till) },
);

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
