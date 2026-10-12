-- =============================================================================
-- Профайлын төрөл (эзэн, 2026-10-10): «ямар компани» эсвэл «оюутан бол ямар сургууль».
--
-- affiliation = 'company' | 'student'; нэр нь хэвээр organization баганад (оюутанд —
-- сургуулийн нэр). Лицензийн `org` талбарт organization л орно — лицензийн формат өөрчлөгдөхгүй.
-- Хуучин профайлд null: дараагийн хүсэлтийн өмнө сонгуулна (guard_request).
-- =============================================================================

alter table public.profiles
    add column affiliation text check (affiliation in ('company', 'student'));

grant update (affiliation) on public.profiles to authenticated;

create or replace function public.guard_request() returns trigger
    language plpgsql security invoker set search_path = public
as $$
begin
    -- Only the browser roles are guarded. The edge function (service_role) and the owner
    -- in the SQL editor (postgres) are trusted — the first admin is made that way.
    -- SECURITY INVOKER on purpose: in a definer function current_user is the owner and
    -- this test would let everyone through (found by the PGlite test, 2026-10-07).
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;
    if tg_op = 'INSERT' then
        if (select count(*) from public.requests
            where user_id = auth.uid() and status = 'pending') >= 3 then
            raise exception 'Хүлээгдэж буй хүсэлт 3-аас ихгүй байна.';
        end if;
        if (select full_name = '' or organization = '' or affiliation is null
            from public.profiles where id = auth.uid()) then
            raise exception 'Эхлээд нэр, компани эсвэл сургуулиа бөглөнө үү.';
        end if;
        if new.renews_license is not null and not exists (
            select 1 from public.licenses where id = new.renews_license and user_id = auth.uid()) then
            raise exception 'Зөвхөн өөрийн лицензийг сунгуулна.';
        end if;
        return new;
    end if;
    -- UPDATE by an admin: only the decision may change, and only from pending to rejected
    -- (approval is the edge function's).
    if old.status <> 'pending' or new.status <> 'rejected'
       or new.user_id <> old.user_id or new.kind <> old.kind or new.machine_id <> old.machine_id
       or new.renews_license is distinct from old.renews_license or new.note <> old.note
       or new.license_id is distinct from old.license_id then
        raise exception 'Зөвхөн хүлээгдэж буй хүсэлтийг татгалзаж болно.';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
    return new;
end $$;

revoke execute on function public.guard_request() from public, anon, authenticated;
