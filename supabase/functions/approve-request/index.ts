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

   Нууц (supabase secrets set): ZLW_PRIVATE_PEM, ZLW_DATA_KEY. (ZLW_PEPPER нь лиценз v2-ынх,
   2026-10-14-өөс хэрэглэгдэхгүй — v3 өгөгдлийн түлхүүрийг компьютерийн TPM түлхүүрээр шифрлэнэ.)
   ========================================================================== */

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import {
  issueLicense, newLicenseNo, ulaanbaatarDate, addDays, PERPETUAL_UNTIL, SUBSCRIPTION_DAYS,
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
    .select('id, user_id, machine_id, machine_key, status, kind, renews_license, profiles!requests_user_id_fkey(full_name, organization)')
    .eq('id', requestId)
    .single();
  if (!request) { return reply(404, { error: 'Хүсэлт олдсонгүй.' }); }
  if (request.status !== 'pending') { return reply(409, { error: 'Хүсэлт аль хэдийн шийдэгдсэн.' }); }
  if (!request.machine_key) {
    return reply(409, {
      error: 'Энэ хүсэлт хуучин хэлбэрийнх (компьютерийн түлхүүргүй). Татгалзаад, хэрэглэгчээр шинэ хувилбарын '
        + 'ZLWLICENSE-ийн хүсэлтийн кодоор дахин хүсүүлнэ үү.',
    });
  }

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
  // The number is random (newLicenseNo, 80 bits) and part of the signed payload, so a
  // collision with the unique column means signing again under a new number. At 80 bits
  // that never happens in practice; the loop is there so it cannot fail if it does.
  // ONE TRANSACTION (issue_license_for_request, 2026-10-14): the licence row and the
  // request's decision are written together under a lock on the request, so a requester can
  // never read a signed licence for a request that another admin decided, or that a crash
  // left half-done. Before, the licence was inserted first and deleted again on a lost race —
  // long enough to be downloaded, and an offline licence once copied cannot be taken back.
  type Issued = { license_id: number; license_no: string; valid_from: string; valid_until: string };
  let licence: Issued | null = null;
  let rpcError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const no = newLicenseNo();
    let armoured: string;
    try {
      ({ armoured } = await issueLicense(
        {
          privatePem: Deno.env.get('ZLW_PRIVATE_PEM')!,
          dataKeyB64: Deno.env.get('ZLW_DATA_KEY')!,
        },
        {
          no, to: profile.full_name, org: profile.organization, edition, from, till,
          requestCode: `ZLWK1.${request.machine_key}`, mid: request.machine_id,
        },
      ));
    } catch (e) {
      const message = (e as Error).message;
      console.error('issueLicense failed:', message);
      // A request whose key does not parse, or does not match its identifier, is the
      // requester's to redo — said as such rather than as a server fault.
      if (/Хүсэлтийн код|таарахгүй|хүлээгдсэн хэлбэр/.test(message)) { return reply(409, { error: message }); }
      return reply(500, { error: 'Лиценз гаргаж чадсангүй. Функцийн логийг шалгана уу.' });
    }

    const { data, error } = await admin.rpc('issue_license_for_request', {
      p_request_id: requestId,
      p_decided_by: who.user.id,
      p_no: no,
      p_machine_id: request.machine_id,
      p_edition: edition,
      p_valid_from: from,
      p_valid_until: till,
      p_license_text: armoured,
    });
    rpcError = error;
    licence = (data as Issued[] | null)?.[0] ?? null;
    if (!(error?.code === '23505' && (error.message ?? '').includes('licenses_no_key'))) {
      break;
    }
  }
  if (rpcError || !licence) {
    const text = rpcError?.message ?? '';
    if (rpcError?.code === 'ZL409' || rpcError?.code === 'ZL404' || text.includes('Prime')) {
      return reply(rpcError?.code === 'ZL404' ? 404 : 409, { error: text });
    }
    console.error('issue_license_for_request failed:', rpcError);
    return reply(500, { error: 'Лицензийг хадгалж чадсангүй.' });
  }

  return reply(200, { license: { no: licence.license_no, valid_from: licence.valid_from, valid_until: licence.valid_until } });
});
