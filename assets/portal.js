/* Порталын нийтлэг хэсэг: Supabase клиент, нэвтрэлтийн төлөв, форматлах туслахууд.
   Хэрэглэгчийн өгөгдлийг ҮРГЭЛЖ textContent-оор бичнэ — innerHTML хэзээ ч үгүй. */

// Өөрийн сайтаас, тогтсон хувилбар (2026-10-10 хамгаалалтын шалгалт H1): гадны CDN
// хакерддвал админы 2 шаттай сесс дотор код ажиллах эрсдэлтэй байсан. Шинэчлэх заавар README-д.
import { createClient } from './vendor/supabase-js-2.117.3.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './portal-config.js';
import { licenceState } from './profile-model.js';

export const configured = !SUPABASE_URL.startsWith('{{');

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } })
  : null;

export const $ = (selector, root = document) => root.querySelector(selector);

/** Элемент үүсгэнэ; текстийг textContent-оор, атрибутыг setAttribute-оор. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) { continue; }
    if (key === 'class') { node.className = value; } else if (key.startsWith('on')) { node.addEventListener(key.slice(2), value); } else { node.setAttribute(key, value === true ? '' : String(value)); }
  }
  for (const child of children.flat()) {
    if (child == null) { continue; }
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function show(node, visible) { node.hidden = !visible; }

export function say(node, text, kind = '') {
  node.textContent = text ?? '';
  node.className = `msg${kind ? ` ${kind}` : ''}`;
}

export const machineDigits = (text) => String(text ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
export const formatMachine = (text) => (machineDigits(text).match(/.{1,4}/g) || []).join('-');
export const date = (value) => (value ? String(value).slice(0, 10) : '');

export function daysLeft(until) {
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date())}T00:00:00Z`);
  const end = new Date(`${date(until)}T00:00:00Z`);
  return Math.max(0, Math.round((end - today) / 86400000) + 1);
}

export const STATUS_MN = {
  pending: 'Хүлээгдэж буй', approved: 'Батлагдсан', rejected: 'Татгалзсан',
  active: 'Идэвхтэй', revoked: 'Цуцлагдсан',
  expired: 'Хугацаа дууссан', expiring: 'Дуусах дөхсөн', future: 'Хүчинтэй болоогүй',
};
export const KIND_MN = { new: 'Шинэ', renewal: 'Сунгалт' };
export const EDITION_MN = { trial: 'Туршилтын', subscription: 'Захиалгат', prime: 'Prime', full: 'Бүрэн' };
export const PERPETUAL_UNTIL = '9999-12-31';
export const ROLE_MN = { user: 'Хэрэглэгч', viewer: 'Харагч', admin: 'Админ' };

/* Нэвтрэлтийн аль үйлчилгээ асаалттай вэ (Auth-ийн нийтийн тохиргоо). Google-ийг самбарт
   асаамагц товч өөрөө гарна; уншиж чадахгүй бол асаалтгүй гэж үзнэ. */
export async function enabledProviders() {
  if (!configured) return {};
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!response.ok) return {};
    return (await response.json()).external ?? {};
  } catch {
    return {};
  }
}

export const statusPill = (status) => el('span', { class: `status ${status}` }, STATUS_MN[status] ?? status);

/** Сангийн алдааг хэрэглэгчид ойлгогдох мөр болгоно. Триггерийн мессеж аль хэдийн монголоор. */
export function explain(error) {
  if (!error) { return ''; }
  const text = String(error.message ?? error);
  const status = Number(error.status ?? error.context?.status);
  if (status === 429 || error.code === 'over_email_send_rate_limit' || /For security purposes/i.test(text)) {
    return 'Хэт олон оролдлого хийсэн байна. Түр хүлээгээд дахин оролдоно уу.';
  }
  if (navigator.onLine === false || /failed to fetch|fetch failed|networkerror|load failed/i.test(text)) {
    return 'Сервертэй холбогдож чадсангүй. Интернэт холболтоо шалгана уу.';
  }
  if (status === 401 || /JWT|refresh.?token|Auth session missing/i.test(text)) {
    window.dispatchEvent(new Event('portal-session-expired'));
    return 'Нэвтрэлт хүчингүй болсон байна. Дахин нэвтэрнэ үү.';
  }
  if (/row-level security|permission denied/i.test(text)) {
    return 'Энэ үйлдэлд эрх хүрэхгүй байна. Эрх өөрчлөгдсөн бол хуудсаа шинэчилнэ үү.';
  }
  if (/machine_id_check/.test(text)) {
    return 'Компьютерийн дугаар 16 оронтой байх ёстой. Жишээ: 3F2A-91C0-7B4E-D218.';
  }
  if (/expired|invalid.*(?:otp|code|token)|(?:otp|code|token).*invalid/i.test(text)) {
    return 'Код буруу эсвэл хугацаа нь дууссан байна. Кодоо шалгах эсвэл шинэ код авна уу.';
  }
  if (/Error sending .*email/i.test(text)) {
    return 'Имэйл илгээж чадсангүй. Хэдэн минутын дараа дахин оролдоно уу.';
  }
  if (status >= 500) {
    return 'Сервер үйлдлийг дуусгаж чадсангүй. Түр хүлээгээд мэдээллээ шинэчилнэ үү.';
  }
  // Триггер ба Edge Function-ийн мессеж аль хэдийн монголоор — тэр чигээр нь.
  if (/[А-Яа-яӨөҮүЁё]/u.test(text)) { return text; }
  return 'Үйлдлийг дуусгаж чадсангүй. Мэдээллээ шинэчлээд дахин шалгана уу.';
}

/** Толгойн цэсэнд нэвтэрсэн хэрэглэгч ба «Гарах»-ыг харуулна (дүрс HTML-д тогтмол, зөвхөн бичиг солигдоно). */
export async function wireNav() {
  const slot = $('#nav-account');
  if (!slot || !supabase) return null;

  const link = $('.nav-user', slot);
  const label = link && $('.nav-user-label', link);

  // HTML бүтэц алдаатай байсан ч caller-д session-ийг буцаана.
  const { data: { session } } = await supabase.auth.getSession();
  if (!link || !label) return session;

  slot.dataset.sessionOwner = 'portal';

  const text = session ? 'Миний хуудас' : 'Нэвтрэх';
  const email = typeof session?.user?.email === 'string'
    ? session.user.email
    : '';

  label.textContent = text;
  link.setAttribute('aria-label', text);
  link.setAttribute('title', email ? `${text} — ${email}` : text);

  // .here, aria-current болон SVG-г HTML-ийн хэвээр хадгална.
  const existingSignout = $('.nav-signout', slot);

  if (!session) {
    existingSignout?.remove();
    return session;
  }

  // wireNav() дахин дуудагдахад холбоос/listener давхардахгүй.
  if (!existingSignout) {
    let signingOut = false;

    const signout = el(
      'a',
      {
        class: 'nav-signout',
        href: 'account.html',
        onclick: async (event) => {
          event.preventDefault();
          if (signingOut) return;

          signingOut = true;
          signout.setAttribute('aria-disabled', 'true');
          signout.setAttribute('aria-busy', 'true');

          try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            location.assign('account.html');
          } catch {
            signingOut = false;
            signout.removeAttribute('aria-disabled');
            signout.removeAttribute('aria-busy');
            const message = $('#portal-msg');
            if (message) say(message, 'Гарч чадсангүй. Холболтоо шалгаад дахин оролдоно уу.', 'err');
            else window.alert('Гарч чадсангүй. Дахин оролдоно уу.');
          }
        },
      },
      'Гарах',
    );

    link.after(signout);
  }

  return session;
}

export async function copy(text, messageNode) {
  try {
    await navigator.clipboard.writeText(text);
    if (messageNode) { say(messageNode, 'Хуулав.', 'ok'); }
  } catch {
    if (messageNode) { say(messageNode, 'Хуулж чадсангүй. Лицензийг «.lic татах» товчоор файлаар авна уу.', 'err'); }
  }
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------------------------- захын төлвүүд (Astra, 2026-10-13) -- */

/** Хүснэгтийн төлөв огнооноос: хугацаа дууссан, дуусах дөхсөн, хүчинтэй болоогүй. */
export function licencePill(licence) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());
  return statusPill(licenceState(licence, today));
}

/** Нийтлэг мэдэгдэл: сүлжээ тасрах, «Мэдээлэл шинэчлэх» товч. */
export function initPortalUX() {
  const network = $('#network-msg');
  if (network) {
    const offline = () => say(network,
      'Интернэт холболтгүй байна. Холболтоо сэргээгээд мэдээллээ шинэчилнэ үү.', 'err');
    window.addEventListener('offline', offline);
    window.addEventListener('online', () => say(network, 'Интернэт холболт сэргэлээ. Мэдээллээ шинэчилж шалгана уу.'));
    if (navigator.onLine === false) offline();
  }
  $('#portal-refresh')?.addEventListener('click', () => location.reload());
}

const busyRoots = new WeakSet();

/** Үйлдлийн турш хэсгийн товч, талбарыг түгжинэ — давхар дарахаас. Клиентийн хамгаалалт л. */
export async function busyAction(root, message, task) {
  if (!root || busyRoots.has(root)) return false;
  busyRoots.add(root);
  root.setAttribute('aria-busy', 'true');
  const controls = [...root.querySelectorAll('button, input, select, textarea')];
  const previous = controls.map((node) => node.disabled);
  controls.forEach((node) => { node.disabled = true; });
  try {
    await task();
    return true;
  } catch (error) {
    say(message, explain(error), 'err');
    return false;
  } finally {
    controls.forEach((node, index) => { if (node.isConnected) node.disabled = previous[index]; });
    root.removeAttribute('aria-busy');
    busyRoots.delete(root);
  }
}

/**
 * Хүснэгт ачаалагчийг ачаалж буй / хоосон / алдаа төлөвтэй болгоно. Хуучирсан хариуг
 * (дараагийн ачаалалт эсвэл гарсны дараа ирсэн) үл тооно. Амжилттай бол true.
 */
export function tableLoader(load, selector, messageSelector, columns, epoch) {
  let sequence = 0;
  return async (...args) => {
    const ticket = ++sequence;
    const version = epoch();
    const current = () => ticket === sequence && version === epoch();
    const body = $(selector);
    const message = $(messageSelector);
    const row = (text) => el('tr', {}, el('td', { colspan: columns, class: 'muted' }, text));

    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(row('Мэдээлэл ачаалж байна…'));
    try {
      await load(...args, current);
      if (!current()) return false;
      if (!body.children.length) body.append(row('Одоогоор бүртгэл алга.'));
      if (message?.classList.contains('err')) say(message, '');
      return true;
    } catch (error) {
      if (!current()) return false;
      body.replaceChildren(row('Мэдээллийг ачаалж чадсангүй.'));
      if (message) say(message, explain(error), 'err');
      return false;
    } finally {
      if (ticket === sequence) body.removeAttribute('aria-busy');
    }
  };
}
