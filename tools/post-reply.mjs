/* =============================================================================
   Хариу бичигч.  —  node tools/post-reply.mjs
   -----------------------------------------------------------------------------
   issue-license.mjs-ийн үлдээсэн reply.md-г хүсэлт дээр бичнэ.

   ХОЁР УДАА БҮҮ БИЧ. Хариу бүрийн эхний мөр далд тэмдэгтэй байдаг
   (<!-- zlw:issued ZLW-2026-0001 -->). Бичихийн өмнө тэр тэмдэг хүсэлт дээр
   аль хэдийн байгаа эсэхийг хардаг тул хүсэлтийг дахин дахин засварлахад ижил
   гомдол дахин дахин бичигдэхгүй.

   Энэ нь бүртгэлийн шалгалтыг ОРЛОХГҮЙ, түүний дараа зогсох хоёр дахь хамгаалалт.
   Нэг нь git-ийн ref дээр, нөгөө нь хүсэлтийн бичвэр дээр тулгуурладаг тул
   аль нэг нь алдсан газар нөгөө нь барина.
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';

const REPLY = 'reply.md';

if (!existsSync(REPLY)) {
  console.log('Бичих хариу алга.');
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = Number(process.env.ZLW_ISSUE);

const body = readFileSync(REPLY, 'utf8');
const marker = /^<!-- (zlw:[^>]*?) -->/.exec(body)?.[1];

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
};

async function api(path, init) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers, ...init });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  }
  return response.json();
}

if (marker) {
  const existing = await api(`/issues/${issueNumber}/comments?per_page=100`);
  if (existing.some((c) => c.body?.includes(`<!-- ${marker} -->`))) {
    console.log(`«${marker}» аль хэдийн бичигдсэн — давхардуулахгүй.`);
    process.exit(0);
  }
}

await api(`/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });

if (existsSync('reply-label.txt')) {
  const label = readFileSync('reply-label.txt', 'utf8').trim();
  if (label) {
    await api(`/issues/${issueNumber}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: [label] }),
    });
  }
}

console.log(`Хариу бичив (#${issueNumber}).`);
