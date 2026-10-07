/* =============================================================================
   approve-request — админ хүсэлтийг батлахад лиценз гаргана.

   POST { request_id: number, edition: 'trial' | 'subscription' | 'prime', days?: 1..3660 }
     trial        — days хоног (анхдагч 30);
     subscription — 365 хоног; сунгалт бол хуучин лицензийн дуусах өдрөөс үргэлжилнэ
                    (эрт сунгавал үлдсэн хоног алдагдахгүй);
     prime        — хугацаагүй (9999-12-31). Нийт 10 — сангийн guard_prime триггер мөрдүүлнэ.
   Authorization: Bearer <хэрэглэгчийн JWT> (supabase.functions.invoke өөрөө өгнө)

   ЭНЭ ФУНКЦ ЛИЦЕНЗ ЗОХИОЖ ЧАДНА, тиймээс хаалга нь гурвалсан:
     1. JWT хүчинтэй, хэрэглэгч олдсон;
     2. тэр хэрэглэгчийн profiles.role = 'admin';
     3. сесс нь TOTP-оор баталгаажсан (aal2) — нууц үг/имэйлийн холбоос дангаараа хүрэхгүй.
   Хүсэлт 'pending' төлөвтэй байх ба шинэчлэл нь нөхцөлтэй update-аар (status =
   'pending') хийгдэх тул хоёр админ зэрэг дарсан ч нэг л лиценз гарна.

   Нууц (supabase secrets set): ZLW_PRIVATE_PEM, ZLW_DATA_KEY, ZLW_PEPPER.
   ========================================================================== */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  issueLicense, ulaanbaatarDate, addDays, PERPETUAL_UNTIL, SUBSCRIPTION_DAYS,
} from '../_shared/license-core.js';

const SITE = Deno.env.get('ZLW_SITE_ORIGIN') ?? 'https://nova-xo.github.io';

const cors = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function claims(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  if (req.method !== 'POST') { return reply(405, { error: 'Зөвхөн POST.' }); }

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) { return reply(401, { error: 'Нэвтрээгүй байна.' }); }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1. The token is verified by the auth server, not just decoded.
  const { data: who, error: whoError } = await admin.auth.getUser(jwt);
  if (whoError || !who?.user) { return reply(401, { error: 'Нэвтрэлт хүчингүй.' }); }

  // 3. aal is read from the same token the auth server just accepted.
  if (claims(jwt).aal !== 'aal2') {
    return reply(403, { error: '2 шаттай баталгаажуулалт (TOTP) шаардлагатай.' });
  }

  // 2. Role from the database, never from the request.
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).single();
  if (me?.role !== 'admin') { return reply(403, { error: 'Админ эрх шаардлагатай.' }); }

  let body: { request_id?: unknown; days?: unknown; edition?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: 'Хүсэлтийн бие JSON биш.' }); }
  const requestId = Number(body.request_id);
  const days = Number(body.days ?? 30);
  const edition = ['trial', 'subscription', 'prime'].includes(body.edition as string)
    ? (body.edition as string)
    : body.edition == null ? 'trial' : null;
  if (!Number.isInteger(requestId) || requestId <= 0) { return reply(400, { error: 'request_id буруу.' }); }
  if (!Number.isInteger(days) || days < 1 || days > 3660) { return reply(400, { error: 'Хоног 1–3660.' }); }
  if (!edition) { return reply(400, { error: 'Төрөл: trial, subscription эсвэл prime.' }); }

  const { data: request } = await admin
    .from('requests')
    .select('id, user_id, machine_id, status, kind, renews_license, profiles!requests_user_id_fkey(full_name, organization)')
    .eq('id', requestId)
    .single();
  if (!request) { return reply(404, { error: 'Хүсэлт олдсонгүй.' }); }
  if (request.status !== 'pending') { return reply(409, { error: 'Хүсэлт аль хэдийн шийдэгдсэн.' }); }

  const profile = request.profiles as unknown as { full_name: string; organization: string };
  const from = ulaanbaatarDate();
  let till: string;
  if (edition === 'prime') {
    till = PERPETUAL_UNTIL;
  } else if (edition === 'subscription') {
    let start = from;
    if (request.kind === 'renewal' && request.renews_license) {
      const { data: old } = await admin.from('licenses')
        .select('valid_until, status').eq('id', request.renews_license).single();
      if (old?.status === 'active' && old.valid_until >= from && old.valid_until < PERPETUAL_UNTIL) {
        start = addDays(old.valid_until, 1);
      }
    }
    till = addDays(start, SUBSCRIPTION_DAYS - 1);
  } else {
    till = addDays(from, days - 1);
  }
  const { data: no, error: noError } = await admin.rpc('next_license_no', { p_year: Number(from.slice(0, 4)) });
  if (noError || !no) { return reply(500, { error: 'Лицензийн дугаар гаргаж чадсангүй.' }); }

  let armoured: string;
  try {
    ({ armoured } = await issueLicense(
      {
        privatePem: Deno.env.get('ZLW_PRIVATE_PEM')!,
        dataKeyB64: Deno.env.get('ZLW_DATA_KEY')!,
        pepperB64: Deno.env.get('ZLW_PEPPER')!,
      },
      { no, to: profile.full_name, org: profile.organization, edition, mid: request.machine_id, from, till },
    ));
  } catch (e) {
    return reply(500, { error: `Лиценз гаргаж чадсангүй: ${(e as Error).message}` });
  }

  const { data: licence, error: insertError } = await admin
    .from('licenses')
    .insert({
      no, user_id: request.user_id, machine_id: request.machine_id, edition,
      valid_from: from, valid_until: till, license_text: armoured,
    })
    .select('id, no, valid_from, valid_until')
    .single();
  if (insertError || !licence) {
    const text = insertError?.message ?? '';
    return reply(text.includes('Prime') ? 409 : 500, { error: text.includes('Prime') ? text : 'Лицензийг хадгалж чадсангүй.' });
  }

  // Conditional on still pending: of two admins clicking at once, only one wins.
  const { data: decided } = await admin
    .from('requests')
    .update({ status: 'approved', decided_by: who.user.id, decided_at: new Date().toISOString(), license_id: licence.id })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');
  if (!decided?.length) {
    await admin.from('licenses').delete().eq('id', licence.id);
    return reply(409, { error: 'Хүсэлт энэ хооронд шийдэгдсэн.' });
  }

  return reply(200, { license: { no: licence.no, valid_from: licence.valid_from, valid_until: licence.valid_until } });
});
