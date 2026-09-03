/* =============================================================================
   Лиценз шалгагч.  —  node tools/verify-license.mjs <нийтийн-түлхүүр.pem> [файл]
   -----------------------------------------------------------------------------
   Plugin дотор хийгдэх шалгалтыг ЯГ ижлээр давтана. Хоёр шалтгаанаар байна:

   1. Түлхүүрийн хос ба гарын үсгийн хэлбэр зөв болохыг plugin бичихээс ӨМНӨ
      батлах. C# тал руу шилжихдээ ажиллахгүй байвал асуудал нь C#-д мөн үү,
      эсвэл олгогчид мөн үү гэдгийг мэдэхийн тулд ажилладаг жишиг хэрэгтэй.
   2. Хэрэглэгч түлхүүрээ шалгуулмаар байвал энэ файлыг өгч болно.

   Файл өгөөгүй бол stdin-ээс уншина.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { createVerify, createPublicKey } from 'node:crypto';

const [, , keyPath, licPath] = process.argv;

if (!keyPath) {
  console.error('Хэрэглээ: node tools/verify-license.mjs <нийтийн-түлхүүр.pem> [лицензийн-файл]');
  process.exit(2);
}

const raw = readFileSync(licPath ?? 0, 'utf8');

/* BEGIN/END мөр ба мөр таслалтыг хаяна: хэрэглэгч файлаа хэрхэн хуулснаас
   шалгалтын хариу хамаарах ёсгүй. */
const text = raw
  .replace(/-----(BEGIN|END) ZENITH LINEWORKS LICENSE-----/g, '')
  .replace(/\s+/g, '');

const parts = text.split('.');
if (parts.length !== 3 || parts[0] !== 'ZLW1') {
  console.error('ХҮЧИНГҮЙ: лицензийн хэлбэр таарахгүй байна.');
  process.exit(1);
}

const [version, payload64, signature64] = parts;
const fromB64Url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const ok = createVerify('SHA256')
  .update(`${version}.${payload64}`)
  .verify(
    { key: createPublicKey(readFileSync(keyPath, 'utf8')), dsaEncoding: 'ieee-p1363' },
    fromB64Url(signature64),
  );

if (!ok) {
  console.error('ХҮЧИНГҮЙ: гарын үсэг таарахгүй байна.');
  process.exit(1);
}

const claim = JSON.parse(fromB64Url(payload64).toString('utf8'));

/* Гарын үсэг зөв ч хугацаа дууссан байж болно. Хоёр нь ӨӨР асуулт: нэг нь
   "энэ бичвэрийг бид гаргасан уу", нөгөө нь "өнөөдөр хүчинтэй юу". Хоёуланг
   тусад нь хэлэхгүй бол хэрэглэгч аль нь болсныг мэдэхгүй. */
const expired = Date.parse(`${claim.till}T23:59:59Z`) < Date.now();

console.log('Гарын үсэг      : зөв');
console.log(`Лицензийн дугаар: ${claim.no}`);
console.log(`Эзэмшигч        : ${claim.to}`);
console.log(`Байгууллага     : ${claim.org}`);
console.log(`Төрөл           : ${claim.ed}`);
console.log(`Хугацаа         : ${claim.from} — ${claim.till}${expired ? '  (ДУУССАН)' : ''}`);
console.log(`Төхөөрөмж       : ${claim.mid || 'хязгаарлаагүй'}`);

process.exit(expired ? 1 : 0);
