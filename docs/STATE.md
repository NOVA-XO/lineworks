# Одоогийн байдал — LineWorks нийтийн сайт ба портал

**Амьд лавлагаа, handoff биш.** Ажлын хэсэг дуусах бүрд шинэчилнэ. Codex-д контекст
өгөхдөө энэ файлыг заана. Сүүлд шинэчилсэн: **2026-10-13**

## 1. Товч байдал

| | |
|---|---|
| Сайт | https://nova-xo.github.io/lineworks/ (GitHub Pages, `main`) |
| Supabase | Байгууллага **Zenith** · төсөл `yfusttksvhdssjizxebc` («NOVA-XO's Project», Free) |
| Edge Function | `approve-request` v4 (`npm:@supabase/supabase-js@2.117.3`) |
| Function secret | `ZLW_PRIVATE_PEM`, `ZLW_DATA_KEY`, `ZLW_PEPPER` (утга нь `00-admin/secrets/zenith-lineworks/`-д) |
| Migration | 6, бүгд синхрон (`supabase migration list`) |
| Storage | `installers/latest/ZenithLineWorksSetup.exe` = plugin **1.8.0** |
| Татах хуудас | GitHub Release **v1.0.0** (лицензийн системгүй хувилбар) — албан ёсны нээлтэд 1.8.0 болно |
| Нэвтрэх имэйл | Өөрийн SMTP (түр): `Zenith LineWorks <zenithsolar.lineworks@gmail.com>`, OTP 6 орон, 900 с |
| Клиентийн сан | `assets/vendor/supabase-js-2.117.3.esm.js` (SHA-256 `5aa99d86…fa60`) |
| Нийтлэг файл | `assets/zs-theme.css/js` — компанийн сайттай **яг ижил** |
| Тест | `tools/test-profile-model.mjs` **7/7** (2026-10-12) |
| Нөөц | Долоо хоног бүр ням 10:00 → `00-admin/secrets/zenith-lineworks/db-backups/` (2026-10-13-нд засагдсан) |

## 2. Тогтмол командууд

```bash
node --test tools/test-profile-model.mjs
npx supabase db push --dry-run --linked --project-ref yfusttksvhdssjizxebc
npx supabase db push --yes --linked --project-ref yfusttksvhdssjizxebc
npx supabase db query --project-ref yfusttksvhdssjizxebc --linked "select 1"
npx supabase functions deploy approve-request --use-api --project-ref yfusttksvhdssjizxebc
npx supabase storage ls ss:///installers/ --recursive --experimental --project-ref yfusttksvhdssjizxebc
node tools/backup-db.mjs
```

`--linked`-ийг ганцаар өгвөл `ProjectRefNotLinkedError` — `--project-ref`-тэй хамт.

## 3. Орчны урхи

| Урхи | Шинж | Шийдэл |
|---|---|---|
| **Supabase-д хоёр байгууллага** (Zenith, irodori) — хоёулаа «NOVA-XO's Project» | Тохиргоо хадгалагдсан ч нөлөөлөхгүй | Хаягийн мөрөнд `yfusttksvhdssjizxebc` эсэхийг шалга |
| Өөрийн SMTP-гүй үед Supabase загварыг үл тоомсорлодог | Имэйл «Your sign-in link», англи | SMTP идэвхтэй эсэхийг шалга |
| Gmail SMTP `535 5.7.8 BadCredentials` | Хаяг буруу (`zenith.lineworks` ≠ `zenithsolar.lineworks`) эсвэл App password зайтай | `openssl s_client -starttls smtp -connect smtp.gmail.com:587` → AUTH PLAIN |
| .NET `SmtpClient` auth алдааг нуудаг | `net_io_connectionclosed` | openssl-ээр шалга |
| Supabase CLI хуваарьт ажлаас хүснэгт хэвлэдэг | `Unexpected end of JSON input` | `--agent no --output json` |
| Хуваарьт ажлын консол хаагдахад процесс тасардаг | `0xC000013A`, лог хоосон | `conhost.exe --headless` |
| `db query`-ийн JSON-д монгол алдааны текст эвдэрдэг | `UnicodeEncodeError` | Туршилтын үр дүнг ASCII-ээр буцаа |
| SQL Editor-оор гараар ажиллуулсан код migration бүртгэлд ордоггүй | `supabase_migrations` хоосон | Зөвхөн migration файл + `db push` |
| Python `-I` нь `PYTHONIOENCODING`-ийг үл тоомсорлоно | cp1252 `UnicodeEncodeError` | `sys.stdout.reconfigure(encoding='utf-8')` |
| Bash heredoc-д урт Python/C# | `unexpected EOF` | Скриптийг Write-аар файл болгон бич |
| Codex sandbox файл уншиж чадахгүй үе | `setup refresh had errors` | Эх файлыг мөрийн дугаартай stdin-ээр өг |

## 4. Шалгаад ЦЭВЭР гэж батлагдсан

| Огноо | Юу | Хэрхэн |
|---|---|---|
| 2026-10-10 | RLS: бусдын мөр, өөрийгөө админ болгох, лиценз шууд нэмэх, аудит засах — хаалттай | `set local role authenticated/service_role` + rollback |
| 2026-10-10 | Edge Function: JWT, админ эрх (сангаас), aal2, зэрэг батлалт | Код уншиж + 401 туршилт |
| 2026-10-10 | Git түүх (32, компанийн сайт)-д нууц алдагдаагүй — зөвхөн anon түлхүүр | Хэв маягаар хайв |
| 2026-10-10 | Клиент XSS — хэрэглэгчийн өгөгдөл зөвхөн `textContent` | Код уншиж |
| 2026-10-12 | Профайлын төрөл: төрөлгүй бол хүсэлт хаагдана, буруу утга татгалзана | Rollback туршилт 4/4 |
| 2026-10-13 | Console-оос anon түлхүүрээр 8 халдлага (унших, админ болох, лиценз нэмэх, батлах, суулгагч, функц) — бүгд хаалттай | curl |
| 2026-10-13 | Supabase-д илүүдэл функц, нууц, storage файл байхгүй | `functions list`, `secrets list`, `storage ls` |

## 5. Нээлттэй / дараагийн ажил

Roadmap (Astra-тай, 2026-10-12): одоо → DNS-ийн өмнө → DNS-ийн дараа → албан ёсны нээлт.

- **DNS шилжүүлэлт** itools.mn → Cloudflare (компанийн данс). Дараа нь: `noreply@zenithsolar.mn`
  (Resend), Gmail App password-ийг хүчингүй болгох, CSP/хамгаалалтын header, redirect/CORS.
- **Нэвтрэх имэйл spam руу орох** — шинэ Gmail; өөрийн домэйн шийднэ.
- **Албан ёсны нээлт:** татах хуудас 1.8.0, порталын хөлийн «1.0.0», шинэ хэрэглэгчийн бүрэн туршилт,
  нөөцөөс сэргээх туршилт.
- Хүсэлт шийдэгдэхэд хэрэглэгчид мэдэгдэх; захын төлвүүдийн UX; нууцлалын тайлбар.
- Google нэвтрэлт (Google Cloud OAuth — эзэн).
- Админ «Батлах» урсгалыг 10-10-ны өөрчлөлтийн дараа бодитоор туршаагүй.
- Supabase Pro — төлбөртэй хэрэглэгч авахаас өмнө.

## 6. Аудитын түүх

| Огноо | Хэн | Олдсон | Юу байсан |
|---|---|---|---|
| 2026-10-10 | Claude (Astra квотгүй) | 9 | H1 CDN хувилбаргүй, H2 түлхүүр/данс, M1 clickjacking, M2 OTP 1 цаг, M3 CSP, M4 нөөц, L1 илүүдэл эрх, L2 алдааны текст, L3 офлайн цуцлалт |
| 2026-10-10 | Astra (UI) | 23 | Цэсний фокус, skip link, контраст, тайлангийн зөрчил, 404 base г.м.; 15 засагдсан, 2 үгүйсгэсэн |
| 2026-10-10 | Astra (2-р шат) | 6 бүлэг | Админ табууд, порталын алдааны мэдээлэл, галерей, үхсэн CSS |
| 2026-10-12 | Astra (roadmap) | 13 | JS-гүй хоосон хуудас, дахин илгээх товч, хувилбарын зөрүү г.м. |
