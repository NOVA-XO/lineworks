-- =============================================================================
-- Хамгаалалтын шалгалт (2026-10-10): Supabase-ийн анхдагч илүүдэл эрхийг хасна.
--
-- RLS нь мөр бүрийг хамгаалдаг ч TRUNCATE-д RLS үйлчилдэггүй. PostgREST энэ тушаалыг
-- гаргадаггүй тул одоо ашиглагдах зам байхгүй, гэхдээ эрх байх ёсгүй.
-- Туслах функцуудыг anon дуудах шаардлагагүй (anon-д дүрэм байхгүй). authenticated нь
-- RLS дүрмүүдэд хэрэглэгддэг my_role / is_staff / is_admin_mfa / prime_remaining-ийг л
-- дуудна. Триггер функцийг дуудагч EXECUTE эрхгүй байсан ч триггер ажилладаг.
-- =============================================================================

revoke truncate, references, trigger on public.profiles, public.requests, public.licenses
    from anon, authenticated;

revoke execute on function
    public.my_role(), public.is_staff(), public.is_admin_mfa(), public.prime_cap(),
    public.guard_license(), public.guard_prime(), public.guard_profile(),
    public.guard_request(), public.on_auth_user_created(), public.prime_remaining()
    from public, anon;

revoke execute on function
    public.guard_license(), public.guard_prime(), public.guard_profile(),
    public.guard_request(), public.on_auth_user_created(), public.prime_cap()
    from authenticated;

grant execute on function
    public.my_role(), public.is_staff(), public.is_admin_mfa(), public.prime_remaining()
    to authenticated;
