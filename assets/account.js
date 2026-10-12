import {
  supabase, configured, $, el, show, say, explain, wireNav, copy, download, enabledProviders,
  machineDigits, formatMachine, date, daysLeft, statusPill, KIND_MN, EDITION_MN, PERPETUAL_UNTIL,
} from './portal.js';
import { INSTALLER_PATH } from './portal-config.js';
import { profileModel } from './profile-model.js';
import { renderProfile } from './profile-view.js';

const here = `${location.origin}${location.pathname}`;
const midFromUrl = new URLSearchParams(location.search).get('mid');
let myLicences = [];
let myProfile = null;
let myRequests = [];

const ubToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());

async function start() {
  if (!configured) { show($('#not-configured'), true); return; }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { render(); }
  });
  await render();

  $('#signin-form').addEventListener('submit', signInWithEmail);
  $('#code-form').addEventListener('submit', verifyCode);
  $('#code-resend').addEventListener('click', () => sendCode(true));
  $('#code-back').addEventListener('click', () => {
    if (codeSending || codeVerifying) return;
    showCodeStep(false);
    $('#signin-email').focus();
  });
  enabledProviders().then((providers) => show($('#signin-google'), providers.google === true));
  $('#signin-google').addEventListener('click', async () => {
    const button = $('#signin-google');
    button.disabled = true;
    say($('#signin-msg'), 'Google нэвтрэлт рүү шилжүүлж байна…');

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: here + location.search },
      });
      if (error) throw error;
    } catch (error) {
      say($('#signin-msg'), explain(error) || 'Google-ээр нэвтэрч чадсангүй. Дахин оролдоно уу.', 'err');
    } finally {
      button.disabled = false;
    }
  });
  $('#profile-form').addEventListener('submit', saveProfile);
  $('#request-form').addEventListener('submit', sendRequest);
  $('#kind').addEventListener('change', () => show($('#renews-label'), $('#kind').value === 'renewal'));
  $('#installer').addEventListener('click', downloadInstaller);
  if (midFromUrl) { $('#machine').value = formatMachine(midFromUrl); }
}

let renderRun = 0;

async function render() {
  const run = ++renderRun;
  const session = await wireNav();
  if (run !== renderRun) return;
  show($('#signed-out'), !session);
  show($('#signed-in'), !!session);
  if (!session) {
    myProfile = null; myLicences = []; myRequests = [];
    return;
  }

  $('#who').textContent = `Нэвтэрсэн: ${session.user.email ?? ''}`;
  const { data: profile, error } = await supabase.from('profiles')
    .select('full_name, organization, affiliation, role, created_at').eq('id', session.user.id).single();
  if (run !== renderRun) return;
  if (error) { say($('#profile-msg'), explain(error), 'err'); return; }
  myProfile = { ...profile, email: session.user.email ?? '' };
  $('#full-name').value = profile.full_name ?? '';
  $('#organization').value = profile.organization ?? '';
  for (const radio of $('#profile-form').querySelectorAll('[name="affiliation"]')) {
    radio.checked = radio.value === profile.affiliation;
  }
  syncOrganization();
  $('#who').textContent = `Нэвтэрсэн: ${session.user.email ?? ''}`;
  if (profile.role !== 'user') {
    $('#who').append(' · ', el('a', { href: 'admin.html' }, 'Удирдлагын хуудас'));
  }
  updateRequestGate();
  await Promise.all([loadLicences(session.user.id), loadRequests(session.user.id)]);
  showProfile();
}

/* Профайлыг лиценз ба хүсэлт хоёулаа ачаалагдсаны дараа, мөн тэдгээр өөрчлөгдөх бүрд. */
function showProfile() {
  if (!myProfile) { return; }
  renderProfile(profileModel({
    profile: myProfile,
    email: myProfile.email,
    licences: myLicences,
    requests: myRequests,
    today: ubToday(),
    currentMachine: midFromUrl ?? '',
  }), { openRequest });
}

function openRequest(machineId, renewalLicenceId) {
  const renewal = renewalLicenceId != null;
  if (machineId) { $('#machine').value = formatMachine(machineId); }
  $('#kind').value = renewal ? 'renewal' : 'new';
  $('#renews').value = renewal ? String(renewalLicenceId) : '';
  show($('#renews-label'), renewal);
  $('#request-form').scrollIntoView({ behavior: 'auto', block: 'start' });
  (renewal ? $('#renews') : $('#machine')).focus({ preventScroll: true });
}

function selectedAffiliation() {
  const value = $('#profile-form [name="affiliation"]:checked')?.value;
  return value === 'company' || value === 'student' ? value : null;
}

function syncOrganization() {
  const affiliation = selectedAffiliation();
  const company = affiliation === 'company';
  $('#organization-label').textContent = affiliation
    ? company ? 'Компанийн нэр' : 'Сургуулийн нэр'
    : 'Компани эсвэл сургуулийн нэр';
  $('#organization').disabled = !affiliation;
  $('#organization').placeholder = affiliation
    ? company ? 'Жишээ: Zenith Solar ХХК' : 'Жишээ: ШУТИС'
    : 'Эхлээд төрлөө сонгоно уу';
  $('#organization').autocomplete = company ? 'organization' : 'off';
  show($('#organization-hint'), !affiliation);
}

function updateRequestGate() {
  const fullName = $('#full-name').value.trim();
  const organization = $('#organization').value.trim();
  const affiliation = selectedAffiliation();
  const ready = Boolean(
    fullName && organization && affiliation && myProfile
    && myProfile.full_name === fullName
    && myProfile.organization === organization
    && myProfile.affiliation === affiliation
  );
  $('#request-submit').disabled = !ready;
  if (!ready) {
    say($('#request-msg'), 'Эхлээд нэр, төрлөө сонгож, компани эсвэл сургуулийн нэрээ бөглөж хадгална уу.');
  }
  return ready;
}

let codeEmail = '';
let codeSending = false;
let codeVerifying = false;
let codeRetryAt = 0;
let codeTimer = null;

function syncCodeControls() {
  const seconds = Math.max(0, Math.ceil((codeRetryAt - Date.now()) / 1000));
  const busy = codeSending || codeVerifying;
  const resend = $('#code-resend');
  const submit = $('#signin-form button[type="submit"]');

  resend.disabled = busy || seconds > 0 || !codeEmail;
  resend.textContent = codeSending ? 'Илгээж байна…'
    : seconds > 0 ? `Код дахин илгээх (${seconds} сек)` : 'Код дахин илгээх';
  submit.disabled = busy || seconds > 0;
  submit.textContent = codeSending ? 'Илгээж байна…'
    : seconds > 0 ? `Нэвтрэх код илгээх (${seconds} сек)` : 'Нэвтрэх код илгээх';
  $('#code-back').disabled = busy;
  $('#signin-email').disabled = busy;
  $('#code-form button[type="submit"]').disabled = busy;
  $('#signin-code').readOnly = busy;

  if (!seconds && codeTimer !== null) {
    clearInterval(codeTimer);
    codeTimer = null;
  }
}

function startCodeCooldown() {
  codeRetryAt = Date.now() + 60000;
  if (codeTimer !== null) clearInterval(codeTimer);
  codeTimer = setInterval(syncCodeControls, 250);
  syncCodeControls();
}

function isCodeRateLimit(error) {
  return error?.code === 'over_email_send_rate_limit'
    || Number(error?.status) === 429
    || /For security purposes/i.test(error?.message ?? '');
}

async function signInWithEmail(event) {
  event.preventDefault();
  await sendCode(false);
}

async function sendCode(resend) {
  if (codeSending || codeVerifying || Date.now() < codeRetryAt) return;
  if (!resend && !$('#signin-form').reportValidity()) return;
  const email = resend ? codeEmail : $('#signin-email').value.trim();
  if (!email) return;

  const message = $(resend ? '#code-msg' : '#signin-msg');
  codeSending = true;
  syncCodeControls();
  say(message, 'Илгээж байна…');

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: here + location.search },
    });
    if (error) throw error;
    codeEmail = email;
    startCodeCooldown();
    say($('#signin-msg'), '');
    showCodeStep(true);
    say($('#code-msg'),
      `${resend ? 'Шинэ код' : 'Код'} илгээгдлээ. Ирэхгүй бол «Спам» хавтсаа шалгана уу. Дахин илгээхэд 60 секунд хүлээнэ үү.`,
      'ok');
  } catch (error) {
    if (isCodeRateLimit(error)) {
      startCodeCooldown();
      say(message,
        'Код илгээх хязгаарт хүрлээ. 60 секунд хүлээгээд дахин оролдоно уу. Хязгаар хэвээр байвал хэсэг хугацааны дараа оролдоно уу.',
        'err');
    } else {
      say(message, explain(error) || 'Код илгээж чадсангүй. Дахин оролдоно уу.', 'err');
    }
  } finally {
    codeSending = false;
    syncCodeControls();
  }
}

/* Имэйлийн код (2026-10-08, эзэн: Autodesk-ийн OTP имэйл шиг). Холбоос нь өөр төхөөрөмж
   дээр нээгдвэл энд нэвтрэхгүй байсан; код нь аль ч төхөөрөмжөөс ажиллана. */
function showCodeStep(on) {
  show($('#signin-form'), !on);
  show($('#code-form'), on);
  $('#code-destination').textContent = on ? `${codeEmail} хаяг руу илгээсэн` : '';
  $('#signin-code').value = '';
  say($('#code-msg'), '');
  syncCodeControls();
  if (on) { $('#signin-code').focus(); }
}

async function verifyCode(event) {
  event.preventDefault();
  if (codeSending || codeVerifying || !codeEmail) return;
  const email = codeEmail;
  const token = $('#signin-code').value.replace(/\D/g, '');
  if (token.length < 6) {
    say($('#code-msg'), 'Имэйлээр ирсэн кодыг бүтнээр нь оруулна уу.', 'err');
    return;
  }

  codeVerifying = true;
  syncCodeControls();
  say($('#code-msg'), 'Шалгаж байна…');
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    showCodeStep(false);
  } catch (error) {
    say($('#code-msg'), /expired|invalid/i.test(error?.message ?? '')
      ? 'Код буруу эсвэл хугацаа нь дууссан. Шинэ код авна уу.'
      : explain(error), 'err');
  } finally {
    codeVerifying = false;
    syncCodeControls();
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const button = $('#profile-form button[type="submit"]');
  if (button.disabled || !$('#profile-form').reportValidity()) return;
  const values = {
    full_name: $('#full-name').value.trim(),
    organization: $('#organization').value.trim(),
    affiliation: selectedAffiliation(),
  };
  if (!values.full_name || !values.organization || !values.affiliation) {
    say($('#profile-msg'), 'Нэр, төрлөө сонгож, компани эсвэл сургуулийн нэрээ бөглөнө үү.', 'err');
    return;
  }

  button.disabled = true;
  $('#request-submit').disabled = true;
  say($('#profile-msg'), 'Хадгалж байна…');
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error('Нэвтрэлтийн хугацаа дууссан. Дахин нэвтэрнэ үү.');

    const { data, error } = await supabase.from('profiles')
      .update(values)
      .eq('id', user.id)
      .select('full_name, organization, affiliation, role, created_at')
      .single();
    if (error) throw error;
    myProfile = { ...data, email: user.email ?? '' };
    say($('#profile-msg'), 'Хадгаллаа.', 'ok');
    say($('#request-msg'), '');
    updateRequestGate();
    showProfile();
  } catch (error) {
    say($('#profile-msg'), explain(error), 'err');
  } finally {
    button.disabled = false;
  }
}

async function sendRequest(event) {
  event.preventDefault();
  if ($('#request-submit').disabled || !updateRequestGate()) return;
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
  showProfile();
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
    .eq('user_id', userId).order('created_at', { ascending: false });
  const body = $('#requests');
  body.replaceChildren();
  if (error) { body.append(el('tr', {}, el('td', { colspan: 5 }, explain(error)))); return; }
  myRequests = data;
  if (!data.length) { body.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Хүсэлт алга.'))); }
  for (const r of data.slice(0, 50)) {
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
for (const radio of $('#profile-form').querySelectorAll('[name="affiliation"]')) {
  radio.addEventListener('input', () => {
    syncOrganization();
    $('#request-submit').disabled = true;
  });
}
start();
