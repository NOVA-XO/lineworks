import {
  supabase, configured, $, el, show, say, explain, wireNav,
  formatMachine, date, statusPill, KIND_MN, EDITION_MN, ROLE_MN, PERPETUAL_UNTIL,
} from './portal.js';

let me = null;        // { id, role }
let canWrite = false; // admin AND aal2 — the database enforces the same rule
let primeLeft = null;  // Prime seats left of 10; the database enforces the cap

async function loadPrimeLeft() {
  const { data, error } = await supabase.rpc('prime_remaining');
  primeLeft = error ? null : data;
  $('#prime-left').textContent = primeLeft === null ? '' : `Prime: ${primeLeft} / 10 үлдсэн`;
}

async function start() {
  if (!configured) { $('#gate').textContent = 'Портал хараахан тохируулагдаагүй байна.'; return; }
  const session = await wireNav();
  if (!session) {
    $('#gate').replaceChildren('Эхлээд ', el('a', { href: 'account.html' }, 'нэвтэрнэ'), ' үү.');
    return;
  }
  const { data: profile, error: profileError } = await supabase.from('profiles').select('id, role').eq('id', session.user.id).single();
  if (profileError) {
    $('#gate').textContent = `Профайлыг ачаалж чадсангүй. ${explain(profileError)}`;
    return;
  }
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
  show($('#mfa-enroll'), false);
  factorId = null;

  const form = $('#mfa-form');
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  form.onsubmit = (event) => {
    if (!factorId) {
      event.preventDefault();
      return;
    }
    return verifyMfa(event);
  };

  say($('#mfa-msg'), 'Баталгаажуулалтыг бэлдэж байна…');

  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;

    const verified = (data?.totp ?? []).find((f) => f.status === 'verified');
    if (verified) {
      factorId = verified.id;
    } else {
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `zlw-${Date.now()}`,
      });
      if (enrollError) throw enrollError;
      $('#mfa-qr').src = enrolled.totp.qr_code;
      $('#mfa-secret').textContent = enrolled.totp.secret;
      show($('#mfa-enroll'), true);
      factorId = enrolled.id;
    }

    submit.disabled = false;
    say($('#mfa-msg'), '');
    $('#mfa-code').focus();
  } catch (error) {
    factorId = null;
    say($('#mfa-msg'),
      `Баталгаажуулалтыг бэлдэж чадсангүй. ${explain(error)} Хуудсыг дахин ачаална уу.`,
      'err');
  }
}

async function verifyMfa(event) {
  event.preventDefault();
  const submit = $('#mfa-form button[type="submit"]');
  if (!factorId || submit.disabled) return;

  submit.disabled = true;
  say($('#mfa-msg'), 'Шалгаж байна…');

  try {
    const code = $('#mfa-code').value.trim();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;

    $('#mfa-code').value = '';
    show($('#mfa'), false);
    canWrite = true;
    openConsole();
    $('#console [role="tab"][aria-selected="true"]').focus();
  } catch (error) {
    say($('#mfa-msg'),
      `Баталгаажуулж чадсангүй. ${explain(error) || 'Дахин оролдоно уу.'}`,
      'err');
  } finally {
    submit.disabled = false;
  }
}

/* --------------------------------------------------------------- console -- */

function openConsole() {
  show($('#gate'), false);
  show($('#console'), true);
  $('#mode').textContent = canWrite ? 'Админ — 2 шаттай баталгаажсан.' : 'Харах эрхтэй — өөрчлөлт хийх боломжгүй.';
  const tablist = $('#console [role="tablist"]');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('#console [role="tabpanel"]')];

  function activateTab(tab, moveFocus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
    }
    if (moveFocus) tab.focus();
    if (tab.dataset.tab === 'audit') loadAudit();
  }

  for (const tab of tabs) {
    tab.onclick = () => activateTab(tab);
    tab.onkeydown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const index = tabs.indexOf(tab);
      let next;

      switch (event.key) {
        case 'ArrowLeft':
          next = (index - 1 + tabs.length) % tabs.length;
          break;
        case 'ArrowRight':
          next = (index + 1) % tabs.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = tabs.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      activateTab(tabs[next], true);
    };
  }

  activateTab(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  loadPrimeLeft().then(loadRequests);
  loadUsers();
  loadLicences();
  loadAudit();
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
        el('option', { value: 'subscription' }, 'Захиалгат · 365 хоног'),
        el('option', { value: 'trial' }, 'Туршилтын'),
        el('option', { value: 'prime', disabled: primeLeft !== null && primeLeft <= 0 }, `Prime · хугацаагүй (${primeLeft ?? '?'} үлдсэн)`));
      const syncDays = () => { days.disabled = edition.value !== 'trial'; };
      edition.addEventListener('change', syncDays);
      syncDays();
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
  if (edition === 'trial' && (!Number.isInteger(days) || days < 1 || days > 3660)) { say($('#requests-msg'), 'Хоног 1–3660.', 'err'); return; }
  if (edition === 'prime' && !confirm(`Prime лиценз хугацаагүй бөгөөд буцааж авах боломжгүй. ${primeLeft} үлдснээс 1-ийг олгох уу?`)) { return; }
  say($('#requests-msg'), 'Лиценз гаргаж байна…');
  const { data, error } = await supabase.functions.invoke('approve-request', { body: { request_id: id, days, edition } });
  if (error || data?.error) {
    let text = data?.error;
    if (!text && error?.context?.json) { try { text = (await error.context.json()).error; } catch { /* ignore */ } }
    say($('#requests-msg'), text || explain(error), 'err');
    return;
  }
  const until = data.license.valid_until === PERPETUAL_UNTIL ? 'хугацаагүй' : data.license.valid_until;
  say($('#requests-msg'), `${data.license.no} олголоо (${data.license.valid_from} — ${until}).`, 'ok');
  await loadPrimeLeft();
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
      el('td', {}, `${date(l.valid_from)} — ${l.valid_until === PERPETUAL_UNTIL ? 'хугацаагүй' : date(l.valid_until)}`), el('td', {}, statusPill(l.status)), el('td', {}, action)));
  }
}

/* ------------------------------------------------------------ audit log -- */

const AUDIT_MN = {
  'request.create': 'Хүсэлт үүссэн',
  'request.approved': 'Хүсэлт батлагдсан',
  'request.rejected': 'Хүсэлт татгалзсан',
  'license.issue': 'Лиценз олгосон',
  'license.revoked': 'Лиценз цуцалсан',
  'license.active': 'Лиценз идэвхжсэн',
  'license.delete': 'Лиценз устгасан',
  'profile.role': 'Эрх өөрчилсөн',
};
const ENTITY_MN = { request: 'Хүсэлт', license: 'Лиценз', profile: 'Хэрэглэгч' };
const ROLE_SOURCE_MN = { service_role: 'Систем (лиценз гаргагч)', postgres: 'SQL Editor' };

const stamp = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const when = (value) => stamp.format(new Date(value)).replace(',', '');

function auditDetails(row) {
  const d = row.details ?? {};
  const parts = [];
  if (d.no) parts.push(d.no);
  if (d.edition) parts.push(EDITION_MN[d.edition] ?? d.edition);
  if (d.valid_until) parts.push(`${d.valid_until === PERPETUAL_UNTIL ? 'хугацаагүй' : `${date(d.valid_until)} хүртэл`}`);
  if (d.kind) parts.push(d.kind === 'renewal' ? 'сунгалт' : 'шинэ');
  if (d.machine_id) parts.push(formatMachine(d.machine_id));
  if (row.action === 'profile.role') parts.push(`${d.email ?? ''} ${ROLE_MN[d.from] ?? d.from} → ${ROLE_MN[d.to] ?? d.to}`.trim());
  if (d.reason) parts.push(`Шалтгаан: ${d.reason}`);
  if (d.note) parts.push(`Тайлбар: ${d.note}`);
  return parts.join(' · ');
}

async function loadAudit() {
  const body = $('#audit');
  const [{ data, error }, { data: people }] = await Promise.all([
    supabase.from('audit_log')
      .select('id, at, actor, db_role, action, entity, entity_id, details')
      .order('id', { ascending: false }).limit(200),
    supabase.from('profiles').select('id, email'),
  ]);
  body.replaceChildren();
  if (error) { say($('#audit-msg'), explain(error), 'err'); return; }
  const emailOf = new Map((people ?? []).map((p) => [p.id, p.email]));
  if (!data.length) { say($('#audit-msg'), 'Бүртгэл хоосон байна.'); return; }
  say($('#audit-msg'), '');
  for (const row of data) {
    const actor = (row.actor && emailOf.get(row.actor))
      ?? ROLE_SOURCE_MN[row.db_role] ?? row.db_role;
    body.append(el('tr', {},
      el('td', { class: 'mono' }, when(row.at)),
      el('td', {}, actor),
      el('td', {}, AUDIT_MN[row.action] ?? row.action),
      el('td', {}, `${ENTITY_MN[row.entity] ?? row.entity} #${row.entity_id}`),
      el('td', {}, auditDetails(row))));
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
