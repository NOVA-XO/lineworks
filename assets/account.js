import {
  supabase, configured, $, el, show, say, explain, wireNav, copy, download, enabledProviders,
  machineDigits, formatMachine, date, daysLeft, statusPill, KIND_MN, EDITION_MN, PERPETUAL_UNTIL,
  initPortalUX, busyAction, tableLoader, licencePill,
} from './portal.js';
import { INSTALLER_PATH } from './portal-config.js';
import { profileModel } from './profile-model.js';
import { renderProfile } from './profile-view.js';
import { parseRequestCode } from '../supabase/functions/_shared/license-core.js';

const here = `${location.origin}${location.pathname}`;
// Licence v3 (2026-10-14): the plug-in and setup open this page with the request code —
// the computer's TPM public key — in the FRAGMENT, which the browser never sends to the
// server. It is taken out of the address bar at once so it is not bookmarked or shared.
// A ?mid= link comes from a plug-in older than v3, which can no longer be licensed.
// Kept in sessionStorage (this tab only) so a sign-in round trip does not lose it — the
// magic link and OAuth return to this page without the fragment (Astra, 2026-10-14).
const CODE_KEY = 'zlw-request-code';
const codeFromHash = new URLSearchParams(location.hash.slice(1)).get('code');
if (codeFromHash) { try { sessionStorage.setItem(CODE_KEY, codeFromHash); } catch {} }
let codeFromUrl = codeFromHash;
if (!codeFromUrl) { try { codeFromUrl = sessionStorage.getItem(CODE_KEY); } catch {} }
const legacyMidInUrl = new URLSearchParams(location.search).has('mid');
if (codeFromHash || legacyMidInUrl) { history.replaceState(null, '', location.pathname); }
let requestKey = null; // { body, machineId } once a request code has been read
let myLicences = [];
let myProfile = null;
let myRequests = [];

const ubToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());

async function start() {
  initPortalUX();
  if (!configured) {
    show($('#not-configured'), true);
    say($('#portal-msg'), '');
    return;
  }

  // Захын төлвүүд (Astra, 2026-10-13): гарвал хувийн хэсгийг тэр дор нь хааж, нэвтэрвэл
  // auth-ийн callback-аас гадуур дахин зурна (callback дотор await хийвэл supabase-js гацдаг).
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { closeAccount('Та гарлаа.'); return; }
    if (event === 'SIGNED_IN') { setTimeout(() => { void render(); }, 0); }
  });
  window.addEventListener('portal-session-expired',
    () => closeAccount('Нэвтрэлт дууссан байна. Үргэлжлүүлэхийн тулд дахин нэвтэрнэ үү.'));

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
  $('#kind').addEventListener('change', () => {
    const renewal = $('#kind').value === 'renewal';
    show($('#renews-label'), renewal);
    if (renewal && $('#renews').options.length <= 1) {
      say($('#request-msg'), 'Сунгах боломжтой хугацаатай лиценз алга. Шинэ лицензийн хүсэлт сонгоно уу.');
    } else {
      updateRequestGate();
    }
  });
  $('#installer').addEventListener('click', downloadInstaller);
  $('#request-code').addEventListener('input', () => { readRequestCode(); });
  if (codeFromUrl) {
    $('#request-code').value = codeFromUrl;
    await readRequestCode();
  } else if (legacyMidInUrl) {
    say($('#request-msg'), 'LineWorks-ийн хуучин хувилбараас нээгдлээ. Шинэ хувилбарыг суулгаад ZLWLICENSE-ээс хүсэлтийн кодоо авна уу.', 'err');
  }
  await render();
}

let renderRun = 0;

function closeAccount(message) {
  ++renderRun;
  myProfile = null;
  myLicences = [];
  myRequests = [];
  show($('#signed-in'), false);
  show($('#signed-out'), true);
  showCodeStep(false);
  $('#request-submit').disabled = true;
  $('#signed-in').removeAttribute('aria-busy');
  say($('#portal-msg'), message);
}

/* Хувийн хэсгийг БҮХ өгөгдөл ирсний дараа л харуулна: уншилтын алдааг «лиценз алга» гэж
   дүрслэхгүй, хуучирсан хариу (дараагийн render эсвэл гарсны дараах) юу ч бичихгүй. */
async function render() {
  const run = ++renderRun;
  const current = () => run === renderRun;
  show($('#signed-in'), false);
  $('#request-submit').disabled = true;
  $('#signed-in').setAttribute('aria-busy', 'true');
  say($('#portal-msg'), 'Мэдээлэл ачаалж байна…');

  try {
    const session = await wireNav();
    if (!current()) return;
    show($('#signed-out'), !session);
    if (!session) {
      myProfile = null; myLicences = []; myRequests = [];
      say($('#portal-msg'), ''); // нэвтрэх хэсэг өөрөө тайлбарлана — давхар мессеж хэрэггүй
      return;
    }

    const { data: profile, error } = await supabase.from('profiles')
      .select('full_name, organization, affiliation, role, created_at').eq('id', session.user.id).single();
    if (!current()) return;
    if (error) throw error;

    myProfile = { ...profile, email: session.user.email ?? '' };
    $('#full-name').value = profile.full_name ?? '';
    $('#organization').value = profile.organization ?? '';
    for (const radio of $('#profile-form').querySelectorAll('[name="affiliation"]')) {
      radio.checked = radio.value === profile.affiliation;
    }
    syncOrganization();
    $('#who').textContent = `Нэвтэрсэн: ${session.user.email ?? ''}`;
    if (profile.role === 'admin' || profile.role === 'viewer') {
      $('#who').append(' · ', el('a', { href: 'admin.html' }, 'Удирдлагын хуудас'));
    }

    const loaded = await Promise.all([loadLicences(session.user.id), loadRequests(session.user.id)]);
    if (!current()) return;
    if (loaded.some((ok) => !ok)) {
      say($('#portal-msg'),
        'Лиценз эсвэл хүсэлтийн мэдээллийг бүрэн ачаалж чадсангүй. Холболтоо шалгаад «Мэдээлэл шинэчлэх» товчийг дарна уу.',
        'err');
    } else {
      say($('#portal-msg'), '');
    }
    updateRequestGate();
    showProfile();
    show($('#signed-in'), true);
  } catch (error) {
    if (current()) say($('#portal-msg'), explain(error), 'err');
  } finally {
    if (current()) $('#signed-in').removeAttribute('aria-busy');
  }
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
    currentMachine: requestKey?.machineId ?? '',
  }), { openRequest });
}

function openRequest(machineId, renewalLicenceId) {
  // The identifier alone cannot be requested for since v3: the request code carries the key.
  // The profile view still says which computer was meant; the code has to come from it.
  const renewal = renewalLicenceId != null;
  $('#kind').value = renewal ? 'renewal' : 'new';
  $('#renews').value = renewal ? String(renewalLicenceId) : '';
  show($('#renews-label'), renewal);
  if (machineId && requestKey?.machineId !== machineDigits(machineId)) {
    say($('#request-msg'), `${formatMachine(machineId)} компьютер дээрх ZLWLICENSE-ийн хүсэлтийн кодыг буулгана уу.`);
  }
  $('#request-form').scrollIntoView({ behavior: 'auto', block: 'start' });
  (renewal ? $('#renews') : $('#request-code')).focus({ preventScroll: true });
}

/** Reads the pasted request code and shows which computer it names. */
let readRun = 0;
async function readRequestCode() {
  const run = ++readRun;
  const text = $('#request-code').value.trim();
  requestKey = null;
  $('#request-machine').textContent = '';
  if (!text) return null;
  try {
    const { machineId, body } = await parseRequestCode(text);
    if (run !== readRun) return null;
    requestKey = { body, machineId };
    $('#request-machine').textContent = `Компьютерийн дугаар: ${formatMachine(machineId)}`;
    say($('#request-msg'), '');
    return requestKey;
  } catch (error) {
    if (run !== readRun) return null;
    say($('#request-msg'), error.message, 'err');
    return null;
  }
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
  const pending = myRequests.filter((request) => request.status === 'pending').length;
  const open = ready && pending < MAX_PENDING;
  $('#request-submit').disabled = !open;

  // Хаалганы мессеж зөвхөн хаалганых: өөр мессеж (амжилт, алдаа) байвал дарж бичихгүй,
  // хаалга нээгдвэл өөрийнхөө бичснийг арилгана.
  const msg = $('#request-msg');
  const gate = !ready
    ? 'Эхлээд нэр, төрлөө сонгож, компани эсвэл сургуулийн нэрээ бөглөж хадгална уу.'
    : pending >= MAX_PENDING
      ? `${MAX_PENDING} хүсэлт хүлээгдэж байна. Аль нэг нь шийдвэрлэгдсэний дараа шинэ хүсэлт илгээх боломжтой.`
      : '';
  if (gate) {
    say(msg, gate);
  } else if (GATE_TEXTS.some((text) => msg.textContent.startsWith(text))) {
    say(msg, '');
  }
  return open;
}

const MAX_PENDING = 3; // DB-ийн триггер мөн ижил хязгаарыг шалгана — энэ нь урьдчилсан мэдэгдэл л
const GATE_TEXTS = ['Эхлээд нэр, төрлөө', `${MAX_PENDING} хүсэлт хүлээгдэж`, 'Сунгах боломжтой хугацаатай'];

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
    if (!$('#signed-out').hidden && !$('#code-form').hidden) {
      say($('#code-msg'), 'Дахин код илгээх боломжтой боллоо.');
    }
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
  $('#signin-code').removeAttribute('aria-invalid');
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
    $('#signin-code').setAttribute('aria-invalid', 'true');
    say($('#code-msg'), /expired|invalid/i.test(error?.message ?? '')
      ? 'Код буруу эсвэл хугацаа нь дууссан байна. Имэйлийн хамгийн сүүлийн кодоо шалгах эсвэл шинэ код авна уу.'
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
  const run = renderRun;
  say($('#profile-msg'), 'Хадгалж байна…');
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (run !== renderRun) return;
    if (authError) throw authError;
    if (!user) { closeAccount('Нэвтрэлт дууссан байна. Үргэлжлүүлэхийн тулд дахин нэвтэрнэ үү.'); return; }

    const { data, error } = await supabase.from('profiles')
      .update(values)
      .eq('id', user.id)
      .select('full_name, organization, affiliation, role, created_at')
      .single();
    if (run !== renderRun) return;
    if (error) throw error;
    myProfile = { ...data, email: user.email ?? '' };
    say($('#profile-msg'), 'Хадгаллаа.', 'ok');
    say($('#request-msg'), '');
    updateRequestGate();
    showProfile();
  } catch (error) {
    if (run === renderRun) say($('#profile-msg'), explain(error), 'err');
  } finally {
    button.disabled = false;
    if (run === renderRun) updateRequestGate();
  }
}

async function sendRequest(event) {
  event.preventDefault();
  if ($('#request-submit').disabled || !updateRequestGate()) return;
  const key = requestKey ?? await readRequestCode();
  if (!key) {
    say($('#request-msg'), 'Хүсэлтийн кодоо ZLWLICENSE цонхноос (эсвэл суулгагчаас) хуулж буулгана уу.', 'err');
    return;
  }
  const kind = $('#kind').value;
  const row = { kind, machine_id: key.machineId, machine_key: key.body, note: $('#note').value.trim() };
  if (kind === 'renewal') {
    const id = Number($('#renews').value);
    if (!id) { say($('#request-msg'), 'Сунгах лицензээ сонгоно уу.', 'err'); return; }
    row.renews_license = id;
  }
  const run = renderRun;
  let submitted = false;
  await busyAction($('#request-form'), $('#request-msg'), async () => {
    say($('#request-msg'), 'Хүсэлт илгээж байна…');
    const { error } = await supabase.from('requests').insert(row);
    if (run !== renderRun) return;
    if (error) throw error;
    submitted = true;
    $('#note').value = '';
    try { sessionStorage.removeItem(CODE_KEY); } catch {}
  });
  if (run !== renderRun || !submitted) { updateRequestGate(); return; }
  await render();
  say($('#request-msg'),
    'Хүсэлт илгээгдлээ. Шийдвэр гарсны дараа «Мэдээлэл шинэчлэх» товчоор лицензээ шалгана уу.', 'ok');
}

async function loadLicences(userId, current = () => true) {
  const { data, error } = await supabase.from('licenses')
    .select('id, no, machine_id, edition, valid_from, valid_until, status, license_text')
    .eq('user_id', userId).order('created_at', { ascending: false });
  if (!current()) return;
  if (error) throw error;
  const body = $('#licenses');
  body.replaceChildren();
  myLicences = data;
  if (!data.length) { body.append(el('tr', {}, el('td', { colspan: 7, class: 'muted' }, 'Лиценз алга.'))); }
  for (const lic of data) {
    body.append(el('tr', {},
      el('td', { class: 'mono' }, lic.no),
      el('td', { class: 'mono' }, formatMachine(lic.machine_id)),
      el('td', {}, EDITION_MN[lic.edition] ?? lic.edition),
      el('td', {}, `${date(lic.valid_from)} — ${lic.valid_until === PERPETUAL_UNTIL ? 'хугацаагүй' : date(lic.valid_until)}`),
      el('td', {}, lic.valid_until === PERPETUAL_UNTIL ? '—' : `${daysLeft(lic.valid_until)} хоног`),
      el('td', {}, licencePill(lic)),
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

async function loadRequests(userId, current = () => true) {
  const { data, error } = await supabase.from('requests')
    .select('created_at, kind, machine_id, status, decision_note')
    .eq('user_id', userId).order('created_at', { ascending: false });
  if (!current()) return;
  if (error) throw error;
  const body = $('#requests');
  body.replaceChildren();
  myRequests = data;
  if (!data.length) { body.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Хүсэлт алга.'))); }
  for (const r of data.slice(0, 50)) {
    body.append(el('tr', {},
      el('td', {}, date(r.created_at)),
      el('td', {}, KIND_MN[r.kind] ?? r.kind),
      el('td', { class: 'mono' }, formatMachine(r.machine_id)),
      el('td', {}, statusPill(r.status)),
      el('td', {}, r.decision_note || (
        r.status === 'pending' ? 'Шийдвэр хүлээгдэж байна.'
          : r.status === 'rejected' ? 'Татгалзсан шалтгаан бичээгүй байна.'
            : r.status === 'approved' ? 'Лицензээ «Миний лицензүүд» хэсгээс авна уу.'
              : '')),
    ));
  }
}

async function downloadInstaller() {
  const run = renderRun;
  await busyAction($('#installer').closest('section'), $('#installer-msg'), async () => {
    say($('#installer-msg'), 'Холбоос бэлдэж байна…');
    const { data, error } = await supabase.storage.from('installers').createSignedUrl(INSTALLER_PATH, 300);
    if (run !== renderRun) return;
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Суулгагч олдсонгүй.');
    say($('#installer-msg'), 'Таталт эхэлж байна…', 'ok');
    location.href = data.signedUrl;
  });
}

$('#full-name').addEventListener('input', updateRequestGate);
$('#organization').addEventListener('input', updateRequestGate);
for (const radio of $('#profile-form').querySelectorAll('[name="affiliation"]')) {
  radio.addEventListener('input', () => {
    syncOrganization();
    updateRequestGate();
  });
}
$('#signin-code').addEventListener('input', () => $('#signin-code').removeAttribute('aria-invalid'));

loadLicences = tableLoader(loadLicences, '#licenses', '#licenses-msg', 7, () => renderRun);
loadRequests = tableLoader(loadRequests, '#requests', '#requests-msg', 5, () => renderRun);
start().catch((error) => say($('#portal-msg'), explain(error), 'err'));
