/* =============================================================================
   Профайлын өгөгдөл — цэвэр функц (DOM, сүлжээгүй), Node-оор тестлэгдэнэ.

   Эзэн, 2026-10-08: «хэрэглэгчийн профайл хэсэгт өөрийн лицензийн төрөл, дуусах
   хугацаа, токен, бүртгэлтэй компьютер гэх мэт байх хэрэгтэй».

   Эх сурвалж нь хэрэглэгчийн өөрийн мөрүүд (RLS): profiles, licenses, requests.
   «Бүртгэлтэй компьютер» гэдэг нь лиценз эсвэл хүсэлтэд нэг ч удаа орсон дугаар.
   ========================================================================== */

export const PERPETUAL_UNTIL = '9999-12-31';
export const EXPIRING_DAYS = 30;

const DAY = 86400000;
const toDay = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/* Дуусах өдрийг ОРУУЛЖ тоолно: өнөөдөр дуусах лицензэд 1 хоног үлдсэн (plugin-ий DaysLeft-тэй ижил). */
export function daysLeftOn(until, today) {
  if (until === PERPETUAL_UNTIL) { return Infinity; }
  return Math.max(0, Math.round((toDay(until) - toDay(today)) / DAY) + 1);
}

/* Нэг лицензийн өнөөдрийн төлөв: active | expiring | expired | revoked | future. */
export function licenceState(lic, today) {
  if (lic.status === 'revoked') { return 'revoked'; }
  if (lic.valid_from > today) { return 'future'; }
  if (lic.valid_until < today) { return 'expired'; }
  return daysLeftOn(lic.valid_until, today) <= EXPIRING_DAYS ? 'expiring' : 'active';
}

const usable = (state) => state === 'active' || state === 'expiring';

/* Аль лиценз «гол» вэ: ажиллаж буйгаас хугацаагүй нь, дараа нь хамгийн сүүлд дуусах нь. */
function better(a, b) {
  if (!a) { return b; }
  const ua = usable(a.state); const ub = usable(b.state);
  if (ua !== ub) { return ua ? a : b; }
  if (a.valid_until !== b.valid_until) { return a.valid_until > b.valid_until ? a : b; }
  return a.id > b.id ? a : b;
}

/* Токеныг бүхэлд нь харуулахгүйн тулд: эхний ба сүүлийн хэсэг л. */
export function maskToken(text) {
  const bare = String(text ?? '').replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');
  if (bare.length <= 24) { return '•'.repeat(bare.length); }
  return `${bare.slice(0, 12)}••••••••${bare.slice(-8)}`;
}

/**
 * @param {{ profile: object, email: string, licences: object[], requests: object[], today: string, currentMachine?: string }} input
 */
export function profileModel({ profile, email, licences, requests, today, currentMachine = '' }) {
  const lics = licences.map((lic) => {
    const state = licenceState(lic, today);
    const perpetual = lic.valid_until === PERPETUAL_UNTIL;
    const total = perpetual ? Infinity : Math.round((toDay(lic.valid_until) - toDay(lic.valid_from)) / DAY) + 1;
    const left = daysLeftOn(lic.valid_until, today);
    return {
      ...lic,
      state,
      perpetual,
      daysLeft: usable(state) ? left : 0,
      /* Хугацааны мөрний дүүргэлт 0…1; хугацаагүйд 1. */
      remaining: perpetual ? 1 : usable(state) ? Math.min(1, left / total) : 0,
      masked: maskToken(lic.license_text),
    };
  });

  let primary = null;
  for (const lic of lics) { primary = better(primary, lic); }

  const machines = new Map();
  const touch = (mid) => {
    if (!machines.has(mid)) {
      machines.set(mid, { machine_id: mid, licence: null, licences: 0, pending: 0, lastSeen: '' });
    }
    return machines.get(mid);
  };
  for (const lic of lics) {
    const m = touch(lic.machine_id);
    m.licences += 1;
    m.licence = better(m.licence, lic);
    if (lic.valid_from > m.lastSeen) { m.lastSeen = lic.valid_from; }
  }
  for (const r of requests) {
    const m = touch(r.machine_id);
    if (r.status === 'pending') { m.pending += 1; }
    const when = String(r.created_at ?? '').slice(0, 10);
    if (when > m.lastSeen) { m.lastSeen = when; }
  }
  const here = String(currentMachine).toUpperCase().replace(/[^0-9A-F]/g, '');
  const machineList = [...machines.values()]
    .map((m) => ({
      ...m,
      isCurrent: here.length === 16 && m.machine_id === here,
      state: m.licence ? m.licence.state : m.pending ? 'pending' : 'none',
    }))
    .sort((a, b) => (b.isCurrent - a.isCurrent)
      || (usable(b.state) - usable(a.state))
      || b.lastSeen.localeCompare(a.lastSeen));

  return {
    name: profile.full_name,
    organization: profile.organization,
    email,
    role: profile.role,
    since: String(profile.created_at ?? '').slice(0, 10),
    complete: Boolean(profile.full_name?.trim() && profile.organization?.trim()),
    primary,
    licences: lics,
    activeCount: lics.filter((l) => usable(l.state)).length,
    machines: machineList,
    pendingCount: requests.filter((r) => r.status === 'pending').length,
  };
}
