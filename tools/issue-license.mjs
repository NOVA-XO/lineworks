/* =============================================================================
   Лиценз олгогч.
   -----------------------------------------------------------------------------
   GitHub Actions дотор ажиллана. Issue form-оор ирсэн хүсэлтийг уншиж, түлхүүр
   гаргаж, бүртгэлд нэмээд, хүсэлт дээр хариу бичнэ.

   ЯАГААД ГАРЫН ҮСЭГ ЗУРДАГ ВЭ. Түлхүүр нь зөвхөн бичвэр биш — ECDSA P-256-аар
   гарын үсэг зурагдсан бичвэр. Ингэснээр программ нь ямар ч сервер рүү залгалгүй,
   зөвхөн дотроо агуулсан нийтийн түлхүүрээр шалгаад дуусна. Лиценз шалгахын тулд
   интернэт шаарддаг систем нь талбарт ажилладаггүй; манай инженерүүд утасны
   сүлжээгүй газар зураг төсөл хийдэг.

   ЯАГААД P-256, Ed25519 БИШ ВЭ. .NET 8 дотор Ed25519 байхгүй, харин
   ECDsa.VerifyData нь суурьдаа бий. Node болон .NET хоёул нэмэлт сан
   шаардахгүй гэдэг нь — plugin тал дээр нэг ч гуравдагч эх сурвалж
   нэмэхгүй гэсэн үг.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createSign, createPrivateKey } from 'node:crypto';

const REGISTRY = 'registry.json';
const TRIAL_DAYS = 30;
const KEY_VERSION = 'ZLW1';

/* ------------------------------------------------------------------ туслах -- */

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const iso = (d) => d.toISOString().slice(0, 10);

function fail(message) {
  console.error('АЛДАА: ' + message);
  process.exitCode = 1;
}

/* Issue form-ын хариу нь "### Гарчиг" мөрүүдээр тусгаарлагдсан markdown болж
   ирдэг. Хоосон орхисон талбарыг GitHub "_No response_" гэж бичдэг тул түүнийг
   хоосон гэж үзнэ. */
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
    .replace(/[`*_<>\[\]|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, most);
}

/* -------------------------------------------------------------------- GitHub -- */

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

async function comment(issueNumber, body) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!response.ok) {
    throw new Error(`Comment failed: ${response.status} ${await response.text()}`);
  }
}

async function label(issueNumber, name) {
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ labels: [name] }),
  });
}

/* ---------------------------------------------------------------------- гол -- */

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;

if (!issue) {
  fail('Энэ ажиллагаа issue-ээс эхлээгүй байна.');
  process.exit();
}

const registry = existsSync(REGISTRY)
  ? JSON.parse(readFileSync(REGISTRY, 'utf8'))
  : [];

/* НЭГ ХҮСЭЛТЭД НЭГ ЛИЦЕНЗ. Issue-г засварлах, шошго дахин наах бүрд ажиллагаа
   дахин эхэлдэг тул давхардлыг эндээс таслахгүй бол нэг хүн гурван түлхүүртэй
   болно. Бүртгэл өөрөө л энэ асуултын цорын ганц хариулт. */
const already = registry.find((r) => r.issue === issue.number);
if (already) {
  console.log(`Хүсэлт #${issue.number} дээр ${already.no} аль хэдийн олгогдсон.`);
  process.exit();
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
  await comment(
    issue.number,
    ['Маягтад засах зүйл байна:', '', ...problems.map((p) => `- ${p}`), '',
      'Хүсэлтээ засаад хадгалахад робот дахин шалгана.'].join('\n'),
  );
  await label(issue.number, 'дутуу');
  fail(problems.join(' '));
  process.exit();
}

const pem = process.env.ZLW_LICENSE_KEY;
if (!pem) {
  await comment(
    issue.number,
    'Лиценз олгогчийн түлхүүр тохируулагдаагүй байна. Хүсэлт хүлээгдэж байна — '
    + 'эзэмшигч `ZLW_LICENSE_KEY` нууцыг тохируулмагц автоматаар олгогдоно.',
  );
  fail('ZLW_LICENSE_KEY нууц байхгүй.');
  process.exit();
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

const payloadJson = JSON.stringify(payload);
const signing = `${KEY_VERSION}.${b64url(payloadJson)}`;
const signature = createSign('SHA256')
  .update(signing)
  .sign({ key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });

const licenseText = `${signing}.${b64url(signature)}`;

const licenseFile = [
  '-----BEGIN ZENITH LINEWORKS LICENSE-----',
  ...(licenseText.match(/.{1,64}/g) || []),
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

/* -------------------------------------------------------------------- хариу -- */

await comment(issue.number, [
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
  `Бүртгэлээс шалгах: https://nova-xo.github.io/lineworks/license.html`,
].join('\n'));

await label(issue.number, 'олгосон');

console.log(`${licenseNo} олгов (хүсэлт #${issue.number}).`);
