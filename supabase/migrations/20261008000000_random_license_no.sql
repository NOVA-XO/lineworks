-- Licence numbers are random (owner, 2026-10-08: «taahad hylbar baina»).
--
-- ZLW-<year>-<seq> told anyone holding one licence how many had been issued and what the
-- next number would be. Numbers are now ZLW-XXXX-XXXX-XXXX-XXXX: 16 characters of
-- Crockford base32 from a CSPRNG (80 bits), made by newLicenseNo() in
-- functions/_shared/license-core.js for both the portal and the local tool. The signature,
-- not the number, is what makes a licence genuine; the number only must not be guessable.
--
-- No portal licence had been issued when this ran, so the format check is enforced on
-- every row. ZLW-2026-0001 (the owner's own, issued locally) is not in this table and
-- stays valid in the plug-in, which never checks the number's shape.

drop function if exists public.next_license_no(integer);
drop table if exists public.license_counter;

alter table public.licenses
    add constraint licenses_no_format check (no ~ '^ZLW(-[0-9A-HJKMNP-TV-Z]{4}){4}$');
