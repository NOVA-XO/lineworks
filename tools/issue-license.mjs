/* =============================================================================
   Лиценз олгогч.
   -----------------------------------------------------------------------------
   GitHub Actions дотор ажиллана. Issue form-оор ирсэн хүсэлтийг уншиж, түлхүүр
   гаргаж, бүртгэлд нэмээд, бичих ёстой хариугаа файлд үлдээнэ.

   ЭНЭ КОД ӨӨРӨӨ ХАРИУ БИЧДЭГГҮЙ. Шалтгаан нь: хоёр ажиллагаа зэрэг ажиллаж
   болно. Нэг хүсэлт нээгдэхэд «opened», шошго наагдахад «labeled» гэсэн хоёр
   үйл явдал гарна. Хоёулаа адилхан хуучин бүртгэлийг уншвал адилхан дугаар
   гаргаж, хоёр өөр гарын үсэгтэй лиценз бичнэ — нэг дугаартай хоёр хүчинтэй
   лиценз. Энэ нь яг ийм байдлаар нэг удаа тохиолдсон.

   Тиймээс шүүр нь push. Бүртгэлээ түрүүлж түлхэж чадсан ажиллагаа л хариу
   бичих эрхтэй; хожимдсон нь дахин fetch хийж, бүртгэлээс өмнөх лицензийг олж,
   юу ч хийхгүй гарна. Дараалал нь GitHub-ийн concurrency биш, git-ийн ref л
   байх ёстой — тэр нь атомын шинжтэй.

   Гарах код:
     0  лиценз гарлаа, бүртгэл бичигдлээ  — түлхээд хариуг нь бич
     3  энэ хүсэлтэд аль хэдийн олгогдсон — юу ч бүү хий
     4  маягт дутуу                       — бүртгэл хөдлөөгүй, гомдлыг нь бич
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createSign, createPrivateKey } from 'node:crypto';

const REGISTRY = 'registry.json';
const REPLY = 'reply.md';
const TRIAL_DAYS = 30;
const KEY_VERSION = 'ZLW1';

const SITE = 'https://nova-xo.github.io/lineworks';

/* ------------------------------------------------------------------ туслах -- */

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const iso = (d) => d.toISOString().slice(0, 10);

/* Хариуг файлд үлдээнэ. Эхний мөр нь далд тэмдэг — хариу бичигч түүгээр нь
   «энэ хариу аль хэдийн бичигдсэн үү» гэдгийг мэднэ. */
function reply(marker, label, lines) {
  writeFileSync(REPLY, `<!-- zlw:${marker} -->\n${lines.join('\n')}\n`, 'utf8');
  writeFileSync('reply-label.txt', label, 'utf8');
}

function parseForm(body) {
  const fields = {};

  /* Эхэнд \n нэмж байгаа нь: ЭХНИЙ гарчиг нь бичвэрийн яг эхэнд, өмнөө мөр
     таслалтгүй ирдэг. Үүнгүйгээр эхний талбар — «Овог, нэр» — үргэлж хоосон
     мэт харагдаж, зөв бөглөсөн маягт буцаагдана. */
  const parts = `\n${String(body || '')}`.split(/\r?\n###\s+/);

  for (const part of parts.slice(1)) {
    const cut = part.indexOf('\n');
    if (cut < 0) { continue; }
    const label = part.slice(0, cut).trim();
    const value = part.slice(cut + 1).trim();
    fields[label] = value === '_No response_' ? '' : value;
  }
  return fields;
}

/* Байгууллагын нэр нийтийн бүртгэлд орох тул markdown-ыг нь хуулахгүй.
   Нэг мөр, зөв уртад тайрсан энгийн бичвэр л хэрэгтэй. */
function plain(text, most = 80) {
  return String(text || '')
    .replace(/[`*_<>[\]|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, most);
}

/* ---------------------------------------------------------------------- гол -- */

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;

if (!issue) {
  console.error('Энэ ажиллагаа issue-ээс эхлээгүй байна.');
  process.exit(1);
}

const registry = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : [];

const already = registry.find((r) => r.issue === issue.number);
if (already) {
  console.log(`Хүсэлт #${issue.number} дээр ${already.no} аль хэдийн олгогдсон.`);
  process.exit(3);
}

const form = parseForm(issue.body);
const person = plain(form['Овог, нэр']);
const org = plain(form['Байгууллага']);
const email = plain(form['И-мэйл'], 120);
const machineRaw = plain(form['Төхөөрөмжийн дугаар (заавал биш)'], 64)
  .toUpperCase()
  .replace(/[^A-F0-9]/g, '');
const host = plain(form['Аль Civil 3D дээр ашиглах вэ'], 40);

const problems = [];
if (!person) { problems.push('Овог, нэр хоосон байна.'); }
if (!org) { problems.push('Байгууллагын нэр хоосон байна.'); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { problems.push('И-мэйл хаяг зөв бичигдээгүй байна.'); }
if (machineRaw && (machineRaw.length < 8 || machineRaw.length > 32)) {
  problems.push('Төхөөрөмжийн дугаар нь 8–32 оронтой hex тэмдэгт байх ёстой.');
}

if (problems.length) {
  reply('invalid', 'дутуу', [
    'Маягтад засах зүйл байна:',
    '',
    ...problems.map((p) => `- ${p}`),
    '',
    'Хүсэлтээ засаад хадгалахад робот дахин шалгана.',
  ]);
  console.error(problems.join(' '));
  process.exit(4);
}

const pem = process.env.ZLW_LICENSE_KEY;
if (!pem) {
  reply('nokey', 'дутуу', [
    'Лиценз олгогчийн түлхүүр тохируулагдаагүй байна. Хүсэлт хүлээгдэж байна —',
    'эзэмшигч `ZLW_LICENSE_KEY` нууцыг тохируулмагц автоматаар олгогдоно.',
  ]);
  console.error('ZLW_LICENSE_KEY нууц байхгүй.');
  process.exit(4);
}

/* ------------------------------------------------------------------ дугаар -- */

const now = new Date();
const year = now.getUTCFullYear();
const used = registry
  .map((r) => /^ZLW-(\d{4})-(\d+)$/.exec(r.no || ''))
  .filter((m) => m && Number(m[1]) === year)
  .map((m) => Number(m[2]));
const seq = (used.length ? Math.max(...used) : 0) + 1;
const licenseNo = `ZLW-${year}-${String(seq).padStart(4, '0')}`;

const expires = new Date(now.getTime() + TRIAL_DAYS * 86400000);

/* Гарын үсэг зурагдах бичвэр. Талбарын дараалал ТОГТМОЛ байх ёстой — JSON-ыг
   дахин цувуулж гарын үсэг шалгадаггүй, яг энэ байтуудыг л шалгана. */
const payload = {
  v: 1,
  no: licenseNo,
  to: person,
  org,
  ed: 'trial',
  host,
  mid: machineRaw,
  from: iso(now),
  till: iso(expires),
};

const signing = `${KEY_VERSION}.${b64url(JSON.stringify(payload))}`;
const signature = createSign('SHA256')
  .update(signing)
  .sign({ key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });

const licenseFile = [
  '-----BEGIN ZENITH LINEWORKS LICENSE-----',
  ...(`${signing}.${b64url(signature)}`.match(/.{1,64}/g) || []),
  '-----END ZENITH LINEWORKS LICENSE-----',
].join('\n');

/* ------------------------------------------------------------------ бүртгэл -- */

registry.push({
  no: licenseNo,
  org,
  edition: 'trial',
  issued: iso(now),
  expires: iso(expires),
  /* Бүрэн дугаарыг НИЙТЭД гаргахгүй. Эхний найм нь тухайн хүн өөрийнхөө
     лицензийг таньж, хайж олоход хангалттай; бүтнээр нь тавих нь бусдын
     төхөөрөмжийн хурууны хээг нийтэлж байгаа хэрэг. */
  machine: machineRaw ? machineRaw.slice(0, 8) : '',
  issue: issue.number,
  status: 'active',
});

writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

reply(`issued ${licenseNo}`, 'олгосон', [
  `**${licenseNo}** олголоо. Хугацаа: **${iso(now)} — ${iso(expires)}** (${TRIAL_DAYS} хоног).`,
  '',
  'Доорх бичвэрийг бүтнээр нь хуулж, дараах зам дээр `zenith-lineworks.lic`',
  'нэрээр хадгална уу:',
  '',
  '```',
  '%APPDATA%\\ZenithLineWorks\\zenith-lineworks.lic',
  '```',
  '',
  '```',
  licenseFile,
  '```',
  '',
  machineRaw
    ? `Энэ лиценз \`${machineRaw.slice(0, 8)}…\` төхөөрөмжид хязгаарлагдсан.`
    : 'Энэ лиценз тодорхой төхөөрөмжид хязгаарлагдаагүй.',
  '',
  '> **Анхаар:** 1.0.0 хувилбар лицензийг хараахан шалгадаггүй — програм',
  '> лицензгүйгээр ч бүрэн ажиллана. Энэ түлхүүр нь шалгалт нэмэгдсэн',
  '> хувилбарт хүчинтэй байна.',
  '',
  `Бүртгэлээс шалгах: ${SITE}/license.html`,
]);

console.log(`${licenseNo} бэлдэв (хүсэлт #${issue.number}). Түлхэгдсэний дараа хүчинтэй.`);
