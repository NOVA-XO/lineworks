/* =============================================================================
   licence-lease — plugin-ий онлайн шалгалт: 7 хоногийн гарын үсэгтэй түрээс (2026-10-15).

   POST { stage: 'challenge', no, mid }         → { challenge, ticket }
   POST { stage: 'answer', ticket, answer }      → { lease, exp }
   Authorization: Bearer <anon key> (нийтийн түлхүүр; хэрэглэгчийн нэвтрэлт шаардахгүй —
   компьютер өөрөө TPM-ийн түлхүүрээрээ нотолно).

   ХАРИУНЫ УТГА (Astra, 2026-10-15) — plugin зөвхөн 403 + refused:true үед л хадгалсан түрээсээ
   устгана; бусад нь «дараа дахин»:
     403 { error, refused: true }  лиценз идэвхгүй / өөр компьютерийнх / хугацаа дууссан / түлхүүргүй;
     400 { error }                 тасалбар буруу, хугацаа дууссан, хариу буруу — дахин сорилт ав;
     429 { error }                 нэг лицензэд 30 секундэд нэгээс олон;
     503 { error }                 сан эсвэл нууц ажиллахгүй — үйлчилгээний алдаа, лицензийн биш.
   Бүх татгалзал (403) НЭГ мессежтэй — гаднаас лиценз байгаа эсэхийг тандахад ашиглагдахгүй.
   Хадгалдаг ганц зүйл: licenses.last_lease_at.

   Нууц: ZLW_PRIVATE_PEM (түрээсийн гарын үсэг), ZLW_LEASE_SECRET (тасалбарын HMAC, ЗӨВХӨН серверт).
   ========================================================================== */

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import {
  makeLeaseChallenge, checkLeaseAnswer, issueLease, normaliseMachineId, ulaanbaatarDate,
} from '../_shared/license-core.js';

const REFUSED = 'Энэ лицензийг сервер баталгаажуулсангүй — цуцлагдсан, хугацаа дууссан эсвэл өөр компьютерийнх.';
const UNAVAILABLE = 'Онлайн шалгалт түр ажиллахгүй байна. Дараа дахин оролдоно уу.';
const MAX_BODY = 4096;
const MIN_SECONDS_BETWEEN = 30;

class Unavailable extends Error {}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

type Licence = {
  id: number; no: string; machine_id: string; machine_key: string | null; status: string;
  valid_until: string; last_lease_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') { return reply(405, { error: 'Зөвхөн POST.' }); }

  const raw = await req.text();
  if (raw.length > MAX_BODY) { return reply(413, { error: 'Хүсэлт хэт том.' }); }
  let body: { stage?: unknown; no?: unknown; mid?: unknown; ticket?: unknown; answer?: unknown };
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Хүсэлтийн бие JSON биш.' }); }

  const privatePem = Deno.env.get('ZLW_PRIVATE_PEM');
  const leaseSecretB64 = Deno.env.get('ZLW_LEASE_SECRET');
  if (!privatePem || !leaseSecretB64) {
    console.error('licence-lease: ZLW_PRIVATE_PEM or ZLW_LEASE_SECRET missing');
    return reply(503, { error: UNAVAILABLE });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  /** The licence when it may have a lease; null when it may not; throws Unavailable when unsure. */
  async function usable(no: unknown, mid: unknown): Promise<Licence | null> {
    if (typeof no !== 'string' || no.length > 64 || typeof mid !== 'string' || mid.length > 32) { return null; }
    const { data, error } = await admin.from('licenses')
      .select('id, no, machine_id, machine_key, status, valid_until, last_lease_at')
      .eq('no', no).maybeSingle();
    if (error) { throw new Unavailable(error.message); }
    const licence = data as Licence | null;
    if (!licence || licence.status !== 'active' || !licence.machine_key) { return null; }
    if (licence.machine_id !== normaliseMachineId(mid)) { return null; }
    if (licence.valid_until < ulaanbaatarDate()) { return null; }
    return licence;
  }

  function tooSoon(licence: Licence): boolean {
    return licence.last_lease_at != null
      && Date.now() - new Date(licence.last_lease_at).getTime() < MIN_SECONDS_BETWEEN * 1000;
  }

  try {
    if (body.stage === 'challenge') {
      const licence = await usable(body.no, body.mid);
      if (!licence) { return reply(403, { error: REFUSED, refused: true }); }
      if (tooSoon(licence)) { return reply(429, { error: 'Түр хүлээгээд дахин оролдоно уу.' }); }
      const { challenge, ticket } = await makeLeaseChallenge({ leaseSecretB64 },
        { no: licence.no, mid: licence.machine_id, machineKey: licence.machine_key! });
      return reply(200, { challenge, ticket });
    }

    if (body.stage === 'answer') {
      let claim: { no: string; mid: string };
      try {
        claim = await checkLeaseAnswer({ leaseSecretB64 }, body.ticket, body.answer);
      } catch (e) {
        return reply(400, { error: (e as Error).message });
      }
      // Checked again: a licence revoked during the two minutes of the ticket gets no lease.
      const licence = await usable(claim.no, claim.mid);
      if (!licence) { return reply(403, { error: REFUSED, refused: true }); }
      if (tooSoon(licence)) { return reply(429, { error: 'Түр хүлээгээд дахин оролдоно уу.' }); }
      const { lease, exp } = await issueLease({ privatePem }, { no: licence.no, mid: licence.machine_id });
      const { error } = await admin.from('licenses').update({ last_lease_at: new Date().toISOString() }).eq('id', licence.id);
      if (error) { console.error('licence-lease: last_lease_at not saved:', error.message); }
      return reply(200, { lease, exp });
    }

    return reply(400, { error: 'stage: challenge эсвэл answer.' });
  } catch (e) {
    console.error('licence-lease failed:', (e as Error).message);
    return reply(503, { error: UNAVAILABLE });
  }
});
