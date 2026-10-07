import {
  supabase, configured, $, el, show, say, explain, wireNav, copy, download,
  machineDigits, formatMachine, date, daysLeft, statusPill, KIND_MN, EDITION_MN, PERPETUAL_UNTIL,
} from './portal.js';
import { INSTALLER_PATH } from './portal-config.js';

const here = `${location.origin}${location.pathname}`;
const midFromUrl = new URLSearchParams(location.search).get('mid');
let myLicences = [];

async function start() {
  if (!configured) { show($('#not-configured'), true); return; }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { render(); }
  });
  await render();

  $('#signin-form').addEventListener('submit', signInWithEmail);
  $('#signin-google').addEventListener('click', () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here + location.search } }));
  $('#profile-form').addEventListener('submit', saveProfile);
  $('#request-form').addEventListener('submit', sendRequest);
  $('#kind').addEventListener('change', () => show($('#renews-label'), $('#kind').value === 'renewal'));
  $('#installer').addEventListener('click', downloadInstaller);
  if (midFromUrl) { $('#machine').value = formatMachine(midFromUrl); }
}

async function render() {
  const session = await wireNav();
  show($('#signed-out'), !session);
  show($('#signed-in'), !!session);
  if (!session) { return; }

  $('#who').textContent = `Нэвтэрсэн: ${session.user.email ?? ''}`;
  const { data: profile, error } = await supabase.from('profiles')
    .select('full_name, organization, role').eq('id', session.user.id).single();
  if (error) { say($('#profile-msg'), explain(error), 'err'); return; }
  $('#full-name').value = profile.full_name;
  $('#organization').value = profile.organization;
  if (profile.role !== 'user') {
    $('#who').append(' · ', el('a', { href: 'admin.html' }, 'Удирдлагын хуудас'));
  }
  updateRequestGate();
  await Promise.all([loadLicences(session.user.id), loadRequests(session.user.id)]);
}

function updateRequestGate() {
  const ready = $('#full-name').value.trim() && $('#organization').value.trim();
  $('#request-submit').disabled = !ready;
  if (!ready) { say($('#request-msg'), 'Эхлээд нэр, байгууллагаа бөглөж хадгална уу.'); }
}

async function signInWithEmail(event) {
  event.preventDefault();
  const email = $('#signin-email').value.trim();
  say($('#signin-msg'), 'Илгээж байна…');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: here + location.search } });
  say($('#signin-msg'), error ? explain(error) : 'Холбоос илгээлээ. Имэйлээ шалгаад холбоосыг дарна уу.', error ? 'err' : 'ok');
}

async function saveProfile(event) {
  event.preventDefault();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles')
    .update({ full_name: $('#full-name').value.trim(), organization: $('#organization').value.trim() })
    .eq('id', user.id);
  say($('#profile-msg'), error ? explain(error) : 'Хадгаллаа.', error ? 'err' : 'ok');
  if (!error) { say($('#request-msg'), ''); updateRequestGate(); }
}

async function sendRequest(event) {
  event.preventDefault();
  const machine = machineDigits($('#machine').value);
  if (machine.length !== 16) {
    say($('#request-msg'), 'Компьютерийн дугаар 16 оронтой (жишээ нь 3F2A-91C0-7B4E-D218) байх ёстой.', 'err');
    return;
  }
  const kind = $('#kind').value;
  const row = { kind, machine_id: machine, note: $('#note').value.trim() };
  if (kind === 'renewal') {
    const id = Number($('#renews').value);
    if (!id) { say($('#request-msg'), 'Сунгах лицензээ сонгоно уу.', 'err'); return; }
    row.renews_license = id;
  }
  const { error } = await supabase.from('requests').insert(row);
  if (error) { say($('#request-msg'), explain(error), 'err'); return; }
  say($('#request-msg'), 'Хүсэлт илгээгдлээ. Батлагдмагц лиценз доор гарна.', 'ok');
  $('#note').value = '';
  const { data: { user } } = await supabase.auth.getUser();
  await loadRequests(user.id);
}

async function loadLicences(userId) {
  const { data, error } = await supabase.from('licenses')
    .select('id, no, machine_id, edition, valid_from, valid_until, status, license_text')
    .eq('user_id', userId).order('created_at', { ascending: false });
  const body = $('#licenses');
  body.replaceChildren();
  if (error) { say($('#licenses-msg'), explain(error), 'err'); return; }
  myLicences = data;
  if (!data.length) { body.append(el('tr', {}, el('td', { colspan: 7, class: 'muted' }, 'Лиценз алга.'))); }
  for (const lic of data) {
    body.append(el('tr', {},
      el('td', { class: 'mono' }, lic.no),
      el('td', { class: 'mono' }, formatMachine(lic.machine_id)),
      el('td', {}, EDITION_MN[lic.edition] ?? lic.edition),
      el('td', {}, `${date(lic.valid_from)} — ${lic.valid_until === PERPETUAL_UNTIL ? 'хугацаагүй' : date(lic.valid_until)}`),
      el('td', {}, lic.valid_until === PERPETUAL_UNTIL ? '—' : `${daysLeft(lic.valid_until)} хоног`),
      el('td', {}, statusPill(lic.status)),
      el('td', {}, el('div', { class: 'actions' },
        el('button', { class: 'btn btn-line', type: 'button', onclick: () => copy(lic.license_text, $('#licenses-msg')) }, 'Хуулах'),
        el('button', { class: 'btn btn-line', type: 'button', onclick: () => download(`${lic.no}.lic`, `${lic.license_text}\n`) }, '.lic татах'))),
    ));
  }
  const renews = $('#renews');
  renews.replaceChildren(el('option', { value: '' }, '— сонгох —'),
    ...data.filter((lic) => lic.valid_until !== PERPETUAL_UNTIL)
      .map((lic) => el('option', { value: lic.id }, `${lic.no} · ${formatMachine(lic.machine_id)} · ${date(lic.valid_until)} хүртэл`)));
}

async function loadRequests(userId) {
  const { data, error } = await supabase.from('requests')
    .select('created_at, kind, machine_id, status, decision_note')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  const body = $('#requests');
  body.replaceChildren();
  if (error) { body.append(el('tr', {}, el('td', { colspan: 5 }, explain(error)))); return; }
  if (!data.length) { body.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Хүсэлт алга.'))); }
  for (const r of data) {
    body.append(el('tr', {},
      el('td', {}, date(r.created_at)),
      el('td', {}, KIND_MN[r.kind] ?? r.kind),
      el('td', { class: 'mono' }, formatMachine(r.machine_id)),
      el('td', {}, statusPill(r.status)),
      el('td', {}, r.decision_note ?? ''),
    ));
  }
}

async function downloadInstaller() {
  say($('#installer-msg'), 'Холбоос бэлдэж байна…');
  const { data, error } = await supabase.storage.from('installers').createSignedUrl(INSTALLER_PATH, 300);
  if (error || !data?.signedUrl) { say($('#installer-msg'), explain(error) || 'Суулгагч олдсонгүй.', 'err'); return; }
  say($('#installer-msg'), '');
  location.href = data.signedUrl;
}

$('#full-name').addEventListener('input', () => { $('#request-submit').disabled = true; });
$('#organization').addEventListener('input', () => { $('#request-submit').disabled = true; });
start();
