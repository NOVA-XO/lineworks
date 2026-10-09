# Zenith LineWorks — нийтийн сайт ба лиценз олгогч

**Сайт:** https://nova-xo.github.io/lineworks/
**Татах:** https://github.com/NOVA-XO/lineworks/releases/latest

Энэ repository нь Zenith LineWorks-ийн **нийтийн тал**: танилцуулга сайт, суулгах файлын
тараалт, лиценз олгох скрипт. Програмын эх код энд **байхгүй**, тусдаа хаалттай
repository-д хадгалагддаг. **Нууц нэг ч байхгүй:** түлхүүр, бүртгэл бүгд эзэмшигчийн
`00-admin/secrets/zenith-lineworks/`-д байна.

---

## Бүрэлдэхүүн

| Файл | Юу вэ |
|---|---|
| `index.html`, `download.html`, `license.html` | Сайт. Статик HTML, build алхамгүй. |
| `assets/zs-theme.css`, `assets/zs-theme.js` | Компанийн сайттай (`00-admin/website`) **яг ижил** нийтлэг сэдэв (2026-10-09, GPT-ийн палитр): хар хөх `#101B35`, шар `#F2C744`, цайвар `#F7F8FA`, Inter + Manrope фонт, толгой, товч, хөл. Анхдагч цайвар, бараан горим товчоор (`zs-theme`); `.band-dark` нь үргэлж бараан хэсэг. Нэг талд засвал нөгөө рүү хуулна. |
| `assets/site.css`, `assets/portal.css` | Энэ сайтын өөрийн хэв маяг (`zs-theme.css`-ийн дараа ачаална). Гаднах эх нь зөвхөн Google Fonts. |
| `assets/img/` | Компанийн лого (цайвар, бараан) ба favicon. |
| `account.html`, `admin.html`, `assets/portal*.js` | Нэвтрэх портал (Supabase). |
| `assets/profile-model.js`, `assets/profile-view.js` | «Миний профайл» (2026-10-08): өгөгдөл (цэвэр, `node --test tools/test-profile-model.mjs`) ба дүрслэл (Astra). |
| `supabase/` | Сан, эрх, лиценз гаргах Edge Function. |
| `tools/issue-license.mjs` | Нөөц олгогч: порталгүйгээр, **эзэмшигчийн компьютер дээр** лиценз гаргана. |
| `tools/new-keypair.mjs` | Гарын үсгийн түлхүүрийн хос үүсгэгч. Нэг л удаа ажиллана. |
| `tools/verify-license.mjs` | Лицензийн гарын үсгийг шалгагч. |

---

## Порталаар лиценз олгох (2026-10-07-ноос)

```
Хэрэглэгч: Civil 3D → ZLWLICENSE → «Хүсэлт илгээх…»
        │  account.html?mid=XXXX-XXXX-XXXX-XXXX нээгдэнэ
        ▼
account.html: имэйлийн холбоос (эсвэл Google)-оор нэвтэрнэ → нэр, байгууллага → хүсэлт
        ▼
admin.html (админ, TOTP 2 шаттай): «Батлах» → Edge Function approve-request
        │  лицензэд гарын үсэг зурж, licenses хүснэгтэд хадгална
        ▼
account.html: «Миний лицензүүд» → «Хуулах» / «.lic татах» → ZLWLICENSE → «Оруулах»
```

| Хэсэг | Хаана |
|---|---|
| Хуудас | `account.html`, `admin.html`, `assets/portal*.js` (GitHub Pages) |
| Сан ба эрх | `supabase/migrations/*_portal.sql` — `profiles`, `requests`, `licenses`, мөрийн эрх (RLS) |
| Лиценз гаргагч | `supabase/functions/approve-request/` + `_shared/license-core.js` (WebCrypto) |
| Суулгагч | Supabase Storage-ийн хувийн `installers` сан. Нэвтэрсэн хэрэглэгчид 5 минутын холбоос үүсгэнэ |

**Миний профайл** (account.html-ийн дээд хэсэг, 2026-10-08):
- нэр, байгууллага, имэйл, эрх, бүртгүүлсэн огноо. «Засах» товчоор өөрчилнө;
- гол лиценз: төрөл, дугаар, дуусах огноо, үлдсэн хоног ба хугацааны мөр. 30 хоногоос бага үлдвэл «Сунгах хүсэлт» товч гарна;
- токен: нууцалж харуулна. «Харуулах», «Хуулах», «.lic татах» товчтой;
- бүртгэлтэй компьютерүүд: лиценз эсвэл хүсэлтэд орсон дугаар бүр, төлөвтэй. `?mid=`-тэй таарвал «Энэ компьютер» гэж тэмдэглэнэ.

Сангийн өөрчлөлтгүй: бүгд хэрэглэгчийн өөрийн мөрүүдээс (RLS).

**Эрх.** Эрхийг хуудсан дээр биш, САН дээр шийддэг:

- `user`:
  - өөрийн нэр, байгууллагыг засна;
  - хүсэлт гаргана (хүлээгдэж буй хүсэлт 3-аас ихгүй);
  - өөрийн лицензээ харна.
- `viewer`: бүгдийг харна, юу ч бичихгүй.
- `admin`:
  - хүсэлт батлах, татгалзах;
  - лиценз цуцлах;
  - бусдын эрхийг өөрчлөх.

  Эдгээрийг **зөвхөн TOTP-оор баталгаажсан сессэд (aal2)** хийнэ. Өөрийнхөө эрхийг өөрчилж чадахгүй.

**Анхаар:** лицензийг сервер дээр гарын үсэг зурж олгодог тул хувийн түлхүүр Supabase-ийн
нууцад (`ZLW_PRIVATE_PEM`) хадгалагдана. Эзэмшигч энэ эрсдэлийг мэдсээр байж сонгосон.
Тиймээс админ данс TOTP-гүйгээр юу ч батлахгүй. Supabase дансандаа 2 шаттай нэвтрэлтийг
**заавал** асаа.

**Цуцалсан лиценз** хугацаа нь дуустал офлайнаар ажилласаар байна: plugin интернэтэд
холбогддоггүй. Тиймээс лицензийг богино хугацаатай олгож, сунгалтаар үргэлжлүүлнэ.

### Одоогийн төлөв (2026-10-07)

- **Supabase төсөл:** `yfusttksvhdssjizxebc`, Tokyo бүсэд (`ap-northeast-1`).
- **Migration:** SQL Editor-оор гараар ажиллуулсан. CLI-ээр `db push` хийхээс өмнө `npx supabase migration repair --status applied 20261007000000` ажиллуулна.
- **Нууц ба функц:** `ZLW_PRIVATE_PEM`, `ZLW_DATA_KEY`, `ZLW_PEPPER` гурван нууц хадгалагдсан. `approve-request` функц байршсан.
- **Суулгагч:** `installers/latest/ZenithLineWorksSetup.exe` = `1.8.0+4febb37` (WPF цонхтой, лицензийн алхамтай: компьютерийн дугаар харуулж, лиценз буулгаад хамт суулгана).
- **Анхны админ:** `superiornova068@gmail.com`.
- **Лицензийн дугаар САНАМСАРГҮЙ** (`20261008000000_random_license_no.sql`, 2026-10-08):
  - Хэлбэр нь `ZLW-XXXX-XXXX-XXXX-XXXX`: криптографийн санамсаргүй 16 тэмдэгт (Crockford base32, I/L/O/U-гүй), 80 бит.
  - Өмнөх дараалсан `ZLW-2026-0001`, `0002`… нь олгосон тоо болон дараагийн дугаарыг ил гаргадаг байв.
  - Портал ба локал хэрэгсэл хоёулаа `license-core.js`-ийн `newLicenseNo()`-оор үүсгэнэ.
  - Сан хэлбэрийг `licenses_no_format`-аар шалгана. `next_license_no` ба `license_counter` устсан.
  - Өмнө олгосон `ZLW-2026-0001` хүчинтэй хэвээр. Plugin дугаарын хэлбэрийг шалгадаггүй.
- **Лицензийн төрөл** (`20261007010000_editions.sql`, CLI `db query --linked`-ээр ажиллуулсан):
  - `trial` — админ хоногийг сонгоно;
  - `subscription` — 365 хоног. Сунгахад хуучин лицензийн дуусах өдрөөс үргэлжилнэ;
  - `prime` — хугацаагүй (`9999-12-31`), **нийт 10**. Цуцалсан ч тоонд орно. Хязгаарыг сангийн `guard_prime` триггер мөрдүүлнэ.

  Локал `issue-license.mjs` prime олгохгүй.
- **Нэвтрэлт:** зөвхөн имэйлээр. Google тохируулаагүй.
- **Нэвтрэх имэйл** (2026-10-08):
  - Албан ёсны загвар `supabase/templates/magic_link.html` ба `confirmation.html` (Astra). Код ба «Порталд нэвтрэх» товч хоёулаа орсон.
  - account.html-д код оруулах алхам бий (`verifyOtp`, type `email`).
  - **Загваруудыг Supabase-д тавих:** Dashboard → Authentication → Email Templates. «Magic Link» ба «Confirm signup»-ийн агуулгыг энэ файлуудаар солино. Гарчиг нь «Zenith LineWorks — нэвтрэх код» ба «Zenith LineWorks — бүртгэлээ баталгаажуулна уу».
  - Код оруулах алхмыг загвар тавигдсаны **дараа** нийтлэнэ. Өмнөх загварт код ороогүй.
  - Илгээгч нь Supabase-ийн өөрийн хаяг (цагт 2 имэйл). Өөрийн хаягаар илгээхэд SMTP тохируулна.

### Supabase-ийг нэг удаа тохируулах

1. supabase.com дээр төсөл үүсгэнэ (бүс: Singapore эсвэл Tokyo). **Project ref** болон
   **anon key**-г `assets/portal-config.js`-д бичнэ. anon key нь нууц биш.
2. Холбоод сангаа үүсгэнэ:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. Нууцуудыг `00-admin/secrets/zenith-lineworks/`-ээс уншиж тохируулна. Утгыг нь дэлгэцэнд
   хэвлэхгүй:
   ```bash
   S=../../00-admin/secrets/zenith-lineworks
   npx supabase secrets set ZLW_PRIVATE_PEM="$(cat $S/private.pem)" ZLW_DATA_KEY="$(cat $S/data.key)" ZLW_PEPPER="$(cat $S/pepper.key)"
   npx supabase functions deploy approve-request
   ```
4. Dashboard → Authentication → URL Configuration: Site URL болон Redirect URL-д
   `https://nova-xo.github.io/lineworks/account.html`, `…/admin.html`-ыг нэмнэ.
   Google-ээр нэвтрүүлэх бол Providers → Google-д OAuth client-ээ оруулна.
5. Supabase-ийн анхдагч имэйл цагт хэдхэн захидал л илгээдэг. Бодит хэрэглээнд
   Authentication → SMTP-д өөрийн имэйлийн серверийг тохируулна.
6. **Анхны админ.** Эхлээд `account.html`-ээр нэвтэрч бүртгэл үүсгэнэ. Дараа нь SQL editor-т:
   `update profiles set role = 'admin' where email = '<имэйл>';`. `admin.html` анх нээхэд
   TOTP бүртгүүлнэ.
7. Суулгагч: Storage → `installers` → `latest/ZenithLineWorksSetup.exe`.

## Түлхүүрийн хэлбэр (v2)

```
ZLW1.<b64url(payload JSON)>.<b64url(signature)>
payload = { v: 2, no, to, org, ed, mid, from, till, dk }
```

`dk` нь plugin дотор шифрлэгдсэн каталог, цаг уурын хүснэгтийг нээх **өгөгдлийн түлхүүр**.
Тухайн компьютерт зориулж AES-256-GCM-ээр боож, лицензэд хийнэ. Лицензгүй бол хүснэгт
задрахгүй. Хэлбэрийн яг тодорхойлолт plugin-ий `Licensing/Core/LicenseCheck.cs` ба
`LicenseSecrets.cs`-д байна. Хоёр тал зөрвөл лиценз ажиллахгүй.

---

## Эзэмшигчид

Нууц файлууд `00-admin/secrets/zenith-lineworks/`-д хадгалагдана. Өөр газар байвал `ZLW_SECRETS` орчны хувьсагчаар заана.

| Файл | Юу вэ |
|---|---|
| `private.pem` | Гарын үсгийн хувийн түлхүүр |
| `public.pem` | Plugin дотор бичигдсэн нийтийн түлхүүр |
| `data.key` | Хүснэгтийн өгөгдлийн түлхүүр (32 байт). Build үед мөн хэрэглэгдэнэ |
| `pepper.key` | Өгөгдлийн түлхүүрийг компьютерт боох давс. Plugin дотор мөн бий |
| `registry.json` | Олгосон лицензийн **хувийн** бүртгэл (нэр, имэйл, компьютер) |
| `issued/*.lic` | Олгосон лиценз бүр |

> **Энэ хавтсыг нөөцөл.**
> - `private.pem` алдвал өмнө олгосон **бүх лиценз хүчингүй** болно.
> - `data.key` алдвал шинэ хувилбарын хүснэгтийг шинэ түлхүүрээр шифрлэх хэрэгтэй болж, бүх лицензийг дахин олгоно.

```bash
node tools/issue-license.mjs --name "Бат Дорж" --org "ABC ХХК" --email bat@abc.mn \
     --mid 3F2A-91C0-7B4E-D218 --days 30 --edition trial
node tools/verify-license.mjs ../../00-admin/secrets/zenith-lineworks/public.pem <лиценз.lic>
```

`--no-mail` өгвөл имэйлийн программ нээгдэхгүй.

---

## Нууцлал

- **Нийтэд гардаггүй:** хүсэлт, хүсэгчийн нэр, имэйл, компьютерийн дугаар. Эдгээр нь зөвхөн
  эзэмшигчийн хувийн бүртгэл болон тухайн хүний лицензэд байна.
- **Програм:** таны зураг, тооцоог хаашаа ч илгээхгүй.

---

© Zenith Solar ХХК. Сайтын эх код нь энэ repository-д нээлттэй. Zenith LineWorks програм
өөрөө нээлттэй эх биш.
