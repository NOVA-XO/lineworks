/* =============================================================================
   Лицензийн түлхүүрийн хос үүсгэгч.  —  node tools/new-keypair.mjs
   -----------------------------------------------------------------------------
   НЭГ Л УДАА ажиллуулна, зөвхөн ӨӨРИЙН компьютер дээр. Гаргасан хувийн түлхүүрийг
   repository-д ХЭЗЭЭ Ч бүү хий — GitHub-ийн Settings → Secrets дотор
   ZLW_LICENSE_KEY нэрээр хадгална.

   Нийтийн түлхүүр нь эсрэгээрээ — нууц биш, харин plugin дотор шууд бичигдэх
   ёстой. Түүнийг мэдсэн хүн лиценз ЗОХИОЖ чадахгүй, зөвхөн ШАЛГАЖ л чадна.

   Хувийн түлхүүрээ алдвал: шинийг үүсгээд plugin дотрох нийтийн түлхүүрийг
   солино. Өмнө олгосон бүх лиценз хүчингүй болно — тиймээс нөөцөлж аваарай.
   ========================================================================== */

import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).trim();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).trim();
const publicDer = publicKey.export({ type: 'spki', format: 'der' });

const line = '='.repeat(78);

console.log(line);
console.log('1. ХУВИЙН ТҮЛХҮҮР  —  GitHub Secret: ZLW_LICENSE_KEY');
console.log('   Settings → Secrets and variables → Actions → New repository secret');
console.log('   Доорхийг БҮТНЭЭР нь, BEGIN/END мөрүүдтэй нь хамт хуулна.');
console.log(line);
console.log(privatePem);

console.log();
console.log(line);
console.log('2. НИЙТИЙН ТҮЛХҮҮР  —  plugin дотор бичигдэнэ (нууц биш)');
console.log(line);
console.log(publicPem);

console.log();
console.log('   C# дотор ашиглах хэлбэр (SPKI, base64):');
console.log();
console.log('   ECDsa.Create().ImportSubjectPublicKeyInfo(Convert.FromBase64String(');
for (const chunk of publicDer.toString('base64').match(/.{1,64}/g)) {
  console.log(`       "${chunk}" +`);
}
console.log('       ""), out _);');
console.log();
