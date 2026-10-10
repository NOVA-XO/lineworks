#!/usr/bin/env node
/* =============================================================================
   Порталын сангийн нөөц (2026-10-10, хамгаалалтын шалгалт S1).

   Supabase-ийн үнэгүй багцад автомат нөөц байхгүй тул долоо хоног бүр (Windows Task
   Scheduler, «ZenithLineWorks DB backup») profiles, requests, licenses, audit_log болон
   migration-ийн жагсаалтыг нэг JSON болгон хадгална.

   Нөөцөд имэйл, лицензийн текст байдаг — НИЙТИЙН РЕПОД ХЭЗЭЭ Ч БИШ:
   анхдагч хавтас нь ../../00-admin/secrets/zenith-lineworks/db-backups (git-ийн гадна).
   Өөр хавтас: ZLW_BACKUP_DIR орчны хувьсагч.

   Нэвтрэлт: Supabase CLI-ийн өөрийнх (npx supabase login). Токен, нууц үг энд байхгүй.
   Ажиллуулах:  node tools/backup-db.mjs
   ========================================================================== */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PROJECT_REF = 'yfusttksvhdssjizxebc';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.ZLW_BACKUP_DIR
  ?? resolve(repo, '..', '..', '00-admin', 'secrets', 'zenith-lineworks', 'db-backups');

const SQL = `
select json_build_object(
  'taken_at',   now(),
  'project',    '${PROJECT_REF}',
  'migrations', (select coalesce(json_agg(version order by version), '[]') from supabase_migrations.schema_migrations),
  'profiles',   (select coalesce(json_agg(t order by t.created_at), '[]') from public.profiles t),
  'requests',   (select coalesce(json_agg(t order by t.id), '[]') from public.requests t),
  'licenses',   (select coalesce(json_agg(t order by t.id), '[]') from public.licenses t),
  'audit_log',  (select coalesce(json_agg(t order by t.id), '[]') from public.audit_log t)
) as dump;
`;

const ubDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());
const log = (line) => {
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, 'backup.log'), `${new Date().toISOString()} ${line}\n`);
  console.log(line);
};

const sqlFile = join(tmpdir(), `zlw-backup-${process.pid}.sql`);
try {
  writeFileSync(sqlFile, SQL);
  const run = spawnSync(`npx --yes supabase db query --project-ref ${PROJECT_REF} --linked --agent no --output json -f "${sqlFile}"`, {
    cwd: repo, encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const raw = run.stdout ?? '';
  const start = [raw.indexOf('['), raw.indexOf('{')].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (run.status !== 0 || start === undefined) {
    const why = `${run.error?.message ?? ''} ${run.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ');
    throw new Error(`supabase CLI (exit ${run.status}): ${why || 'хоосон хариу'}`);
  }
  // `--agent no --output json` нь мөрүүдийн массив; агент горимд { rows: [...] }.
  const parsed = JSON.parse(raw.slice(start));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  const cell = rows?.[0]?.dump;
  const dump = typeof cell === 'string' ? JSON.parse(cell) : cell;
  if (!dump || !Array.isArray(dump.profiles)) { throw new Error('Хариу хүлээгдсэн хэлбэртэй биш.'); }

  const file = join(outDir, `lineworks-db_${ubDate}.json`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(dump, null, 2)}\n`);
  log(`OK ${file} profiles=${dump.profiles.length} requests=${dump.requests.length} `
    + `licenses=${dump.licenses.length} audit=${dump.audit_log.length} migrations=${dump.migrations.length}`);
} catch (error) {
  log(`FAIL ${error.message ?? String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(sqlFile, { force: true });
}
