import {
  supabase, configured, $, el, show, say, explain, wireNav,
  formatMachine, date, statusPill, KIND_MN, EDITION_MN, ROLE_MN,
} from './portal.js';

let me = null;        // { id, role }
let canWrite = false; // admin AND aal2 — the database enforces the same rule

async function start() {
  if (!configured) { $('#gate').textContent = 'Портал хараахан тохируулагдаагүй байна.'; return; }
  const session = await wireNav();
  if (!session) {
    $('#gate').replaceChildren('Эхлээд ', el('a', { href: 'account.html' }, 'нэвтэрнэ'), ' үү.');
    return;
  }
  const { data: profile } = await supabase.from('profiles').select('id, role').eq('id', session.user.id).single();
  if (!profile || profile.role === 'user') { $('#gate').textContent = 'Эрх хүрэхгүй байна.'; return; }
  me = profile;

  if (me.role === 'admin') {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') { show($('#gate'), false); await startMfa(); return; }
    canWrite = true;
  }
  openConsole();
}

/* ------------------------------------------------------------------ TOTP -- */

let factorId = null;

async function startMfa() {
  show($('#mfa'), true);
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).find((f) => f.status === 'verified');
  if (verified) {
    factorId = verified.id;
  } else {
    const { data: enrolled, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `zlw-${Date.now()}` });
    if (error) { say($('#mfa-msg'), explain(error), 'err'); return; }
    factorId = enrolled.id;
    $('#mfa-qr').src = enrolled.totp.qr_code;
    $('#mfa-secret').textContent = enrolled.totp.secret;
    show($('#mfa-enroll'), true);
  }
  $('#mfa-form').addEventListener('submit', verifyMfa);
}

async function verifyMfa(event) {
  event.preventDefault();
  const code = $('#mfa-code').value.trim();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) { say($('#mfa-msg'), 'Код буруу эсвэл хугацаа нь өнгөрсөн.', 'err'); return; }
  show($('#mfa'), false);
  canWrite = true;
  openConsole();
}

/* --------------------------------------------------------------- console -- */

function openConsole() {
  show($('#gate'), false);
  show($('#console'), true);
  $('#mode').textContent = canWrite ? 'Админ — 2 шаттай баталгаажсан.' : 'Харах эрхтэй — өөрчлөлт хийх боломжгүй.';
  for (const tab of document.querySelectorAll('[role=tab]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[role=tab]')) { t.setAttribute('aria-selected', String(t === tab)); }
      for (const p of document.querySelectorAll('[data-panel]')) { p.hidden = p.dataset.panel !== tab.dataset.tab; }
    });
  }
  loadRequests();
  loadUsers();
  loadLicences();
}

const who = (p) => (p ? [p.email, p.full_name, p.organization].filter(Boolean).join(' · ') : '');

async function loadRequests() {
  const { data, error } = await supabase.from('requests')
    .select('id, created_at, kind, machine_id, note, status, decision_note, profiles!requests_user_id_fkey(email, full_name, organization)')
    .order('status', { ascending: false }).order('created_at', { ascending: false }).limit(200);
  const body = $('#requests');
  body.replaceChildren();
  if (error) { say($('#requests-msg'), explain(error), 'err'); return; }
  const pendingFirst = [...data].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
  if (!pendingFirst.length) { body.append(el('tr', {}, el('td', { colspan: 7, class: 'muted' }, 'Хүсэлт алга.'))); }
  for (const r of pendingFirst) {
    const actions = el('div', { class: 'actions' });
    if (r.status === 'pending' && canWrite) {
      const days = el('input', { type: 'number', min: 1, max: 3660, value: 30, style: 'width:5.5em', 'aria-label': 'Хоног' });
      const edition = el('select', { 'aria-label': 'Төрөл' },
        el('option', { value: 'trial' }, 'Туршилтын'), el('option', { value: 'full' }, 'Бүрэн'));
      actions.append(days, edition,
        el('button', { class: 'btn btn-sun', type: 'button', onclick: () => approve(r.id, Number(days.value), edition.value) }, 'Батлах'),
        el('button', { class: 'btn btn-line', type: 'button', onclick: () => reject(r.id) }, 'Татгалзах'));
    }
    body.append(el('tr', {},
      el('td', {}, date(r.created_at)),
      el('td', {}, who(r.profiles)),
      el('td', {}, KIND_MN[r.kind] ?? r.kind),
      el('td', { class: 'mono' }, formatMachine(r.machine_id)),
      el('td', {}, r.note || r.decision_note || ''),
      el('td', {}, statusPill(r.status)),
      el('td', {}, actions),
    ));
  }
}

async function approve(id, days, edition) {
  if (!Number.isInteger(days) || days < 1 || days > 3660) { say($('#requests-msg'), 'Хоног 1–3660.', 'err'); return; }
  say($('#requests-msg'), 'Лиценз гаргаж байна…');
  const { data, error } = await supabase.functions.invoke('approve-request', { body: { request_id: id, days, edition } });
  if (error || data?.error) {
    let text = data?.error;
    if (!text && error?.context?.json) { try { text = (await error.context.json()).error; } catch { /* ignore */ } }
    say($('#requests-msg'), text || explain(error), 'err');
    return;
  }
  say($('#requests-msg'), `${data.license.no} олголоо (${data.license.valid_from} — ${data.license.valid_until}).`, 'ok');
  loadRequests();
  loadLicences();
}

async function reject(id) {
  const reason = prompt('Татгалзсан шалтгаан (хэрэглэгчид харагдана):', '');
  if (reason === null) { return; }
  const { error } = await supabase.from('requests')
    .update({ status: 'rejected', decision_note: reason.slice(0, 300) }).eq('id', id);
  say($('#requests-msg'), error ? explain(error) : 'Татгалзлаа.', error ? 'err' : 'ok');
  loadRequests();
}

async function loadUsers() {
  const { data, error } = await supabase.from('profiles')
    .select('id, email, full_name, organization, role, created_at').order('created_at', { ascending: false });
  const body = $('#users');
  body.replaceChildren();
  if (error) { say($('#users-msg'), explain(error), 'err'); return; }
  for (const p of data) {
    let roleCell = ROLE_MN[p.role] ?? p.role;
    if (canWrite && p.id !== me.id) {
      roleCell = el('select', { 'aria-label': 'Эрх', onchange: (e) => setRole(p.id, e.target.value) },
        ...['user', 'viewer', 'admin'].map((r) => el('option', { value: r, selected: r === p.role }, ROLE_MN[r])));
    }
    body.append(el('tr', {},
      el('td', {}, p.email), el('td', {}, p.full_name), el('td', {}, p.organization),
      el('td', {}, date(p.created_at)), el('td', {}, roleCell)));
  }
}

async function setRole(id, role) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
  say($('#users-msg'), error ? explain(error) : 'Эрхийг өөрчиллөө.', error ? 'err' : 'ok');
  loadUsers();
}

async function loadLicences() {
  const { data, error } = await supabase.from('licenses')
    .select('id, no, machine_id, edition, valid_from, valid_until, status, revoked_reason, profiles(email, full_name, organization)')
    .order('created_at', { ascending: false }).limit(500);
  const body = $('#licenses');
  body.replaceChildren();
  if (error) { say($('#licenses-msg'), explain(error), 'err'); return; }
  for (const l of data) {
    const action = l.status === 'active' && canWrite
      ? el('button', { class: 'btn btn-line', type: 'button', onclick: () => revoke(l.id, l.no) }, 'Цуцлах')
      : (l.revoked_reason ?? '');
    body.append(el('tr', {},
      el('td', { class: 'mono' }, l.no), el('td', {}, who(l.profiles)),
      el('td', { class: 'mono' }, formatMachine(l.machine_id)), el('td', {}, EDITION_MN[l.edition] ?? l.edition),
      el('td', {}, `${date(l.valid_from)} — ${date(l.valid_until)}`), el('td', {}, statusPill(l.status)), el('td', {}, action)));
  }
}

async function revoke(id, no) {
  const reason = prompt(`${no}-ыг цуцлах шалтгаан:`, '');
  if (reason === null) { return; }
  const { error } = await supabase.from('licenses').update({ status: 'revoked', revoked_reason: reason.slice(0, 300) }).eq('id', id);
  say($('#licenses-msg'), error ? explain(error) : `${no} цуцлагдлаа.`, error ? 'err' : 'ok');
  loadLicences();
}

start();
