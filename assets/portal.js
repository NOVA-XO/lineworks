/* Порталын нийтлэг хэсэг: Supabase клиент, нэвтрэлтийн төлөв, форматлах туслахууд.
   Хэрэглэгчийн өгөгдлийг ҮРГЭЛЖ textContent-оор бичнэ — innerHTML хэзээ ч үгүй. */

// Өөрийн сайтаас, тогтсон хувилбар (2026-10-10 хамгаалалтын шалгалт H1): гадны CDN
// хакерддвал админы 2 шаттай сесс дотор код ажиллах эрсдэлтэй байсан. Шинэчлэх заавар README-д.
import { createClient } from './vendor/supabase-js-2.117.3.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './portal-config.js';

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
};
export const KIND_MN = { new: 'Шинэ', renewal: 'Сунгалт' };
export const EDITION_MN = { trial: 'Туршилтын', subscription: 'Захиалгат', prime: 'Prime', full: 'Бүрэн' };
export const PERPETUAL_UNTIL = '9999-12-31';
export const ROLE_MN = { user: 'Хэрэглэгч', viewer: 'Харагч', admin: 'Админ' };

export const statusPill = (status) => el('span', { class: `status ${status}` }, STATUS_MN[status] ?? status);

/** Сангийн алдааг хэрэглэгчид ойлгогдох мөр болгоно. Триггерийн мессеж аль хэдийн монголоор. */
export function explain(error) {
  if (!error) { return ''; }
  const text = error.message || String(error);
  if (/row-level security|permission denied/i.test(text)) { return 'Энэ үйлдэлд эрх хүрэхгүй байна.'; }
  if (/machine_id_check/.test(text)) { return 'Компьютерийн дугаар 16 оронтой (жишээ нь 3F2A-91C0-7B4E-D218) байх ёстой.'; }
  if (/JWT|expired/i.test(text)) { return 'Нэвтрэлтийн хугацаа дууссан. Дахин нэвтэрнэ үү.'; }
  return text;
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
            window.alert('Гарч чадсангүй. Дахин оролдоно уу.');
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
    if (messageNode) { say(messageNode, 'Хуулж чадсангүй — гараар сонгож хуулна уу.', 'err'); }
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
