-- =============================================================================
-- Zenith LineWorks portal: users, licence requests, licences.
--
-- Everything a browser may do is decided HERE, by row-level security, not by the pages:
-- the site is public and its JavaScript is the user's to change. The anon key in the
-- page only identifies the project.
--
--   user    - own profile (name, organisation), own requests (insert while pending
--             count < 3), own licences (read).
--   viewer  - reads everything, writes nothing.
--   admin   - reads everything; rejects requests, revokes licences, changes roles —
--             ONLY in a session that passed TOTP (aal2). Approving (signing) is the
--             edge function approve-request, which checks the same.
--
-- Licences are inserted only by the edge function (service role); no policy grants it.
-- =============================================================================

create type public.portal_role as enum ('user', 'viewer', 'admin');

create table public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    email        text not null,
    full_name    text not null default '' check (char_length(full_name) <= 80),
    organization text not null default '' check (char_length(organization) <= 80),
    role         public.portal_role not null default 'user',
    created_at   timestamptz not null default now()
);

create table public.licenses (
    id             bigint generated always as identity primary key,
    no             text not null unique,
    user_id        uuid not null references public.profiles (id),
    machine_id     text not null check (machine_id ~ '^[0-9A-F]{16}$'),
    edition        text not null check (edition in ('trial', 'full')),
    valid_from     date not null,
    valid_until    date not null,
    license_text   text not null,
    status         text not null default 'active' check (status in ('active', 'revoked')),
    revoked_at     timestamptz,
    revoked_reason text check (char_length(revoked_reason) <= 300),
    created_at     timestamptz not null default now()
);

create table public.requests (
    id             bigint generated always as identity primary key,
    user_id        uuid not null default auth.uid() references public.profiles (id),
    kind           text not null check (kind in ('new', 'renewal')),
    machine_id     text not null check (machine_id ~ '^[0-9A-F]{16}$'),
    renews_license bigint references public.licenses (id),
    note           text not null default '' check (char_length(note) <= 500),
    status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    decided_by     uuid references public.profiles (id),
    decided_at     timestamptz,
    decision_note  text check (char_length(decision_note) <= 300),
    license_id     bigint references public.licenses (id),
    created_at     timestamptz not null default now(),
    check ((kind = 'renewal') = (renews_license is not null))
);

create index on public.requests (status, created_at);
create index on public.licenses (user_id);

-- Licence numbers ZLW-<year>-<seq>, issued only by the portal.
create table public.license_counter (
    year integer primary key,
    last integer not null
);
-- ZLW-2026-0001 was issued by the local tool before the portal existed (the owner's own
-- licence). The local tool now numbers ZLW-<year>-L<seq>, so the two never collide.
insert into public.license_counter (year, last) values (2026, 1);

-- ------------------------------------------------------------------ helpers --

create function public.my_role() returns public.portal_role
    language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create function public.is_staff() returns boolean
    language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role() in ('viewer', 'admin'), false) $$;

-- An admin action needs the role AND a TOTP-verified session.
create function public.is_admin_mfa() returns boolean
    language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role() = 'admin', false)
            and coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

create function public.next_license_no(p_year integer) returns text
    language plpgsql security definer set search_path = public
as $$
declare
    n integer;
begin
    insert into public.license_counter (year, last) values (p_year, 1)
        on conflict (year) do update set last = public.license_counter.last + 1
        returning last into n;
    return format('ZLW-%s-%s', p_year, lpad(n::text, 4, '0'));
end $$;
revoke execute on function public.next_license_no(integer) from public, anon, authenticated;
grant execute on function public.next_license_no(integer) to service_role;

-- A profile for every account, created with the account.
create function public.on_auth_user_created() returns trigger
    language plpgsql security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
    return new;
end $$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.on_auth_user_created();

-- Columns a user may not touch on their own rows, whatever the policy allowed.
create function public.guard_profile() returns trigger
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
    if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at then
        raise exception 'Энэ талбарыг өөрчлөх боломжгүй.';
    end if;
    if new.role <> old.role then
        if not public.is_admin_mfa() then
            raise exception 'Эрх өөрчлөх нь зөвхөн 2 шаттай баталгаажсан админд.';
        end if;
        if old.id = auth.uid() then
            raise exception 'Өөрийнхөө эрхийг өөрчлөх боломжгүй.';
        end if;
    end if;
    return new;
end $$;

create trigger guard_profile before update on public.profiles
    for each row execute function public.guard_profile();

create function public.guard_request() returns trigger
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
        if (select full_name = '' or organization = '' from public.profiles where id = auth.uid()) then
            raise exception 'Эхлээд нэр, байгууллагаа бөглөнө үү.';
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

create trigger guard_request before insert or update on public.requests
    for each row execute function public.guard_request();

create function public.guard_license() returns trigger
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
    if old.status <> 'active' or new.status <> 'revoked'
       or new.no <> old.no or new.user_id <> old.user_id or new.machine_id <> old.machine_id
       or new.edition <> old.edition or new.valid_from <> old.valid_from
       or new.valid_until <> old.valid_until or new.license_text <> old.license_text then
        raise exception 'Зөвхөн идэвхтэй лицензийг цуцалж болно.';
    end if;
    new.revoked_at := now();
    return new;
end $$;

create trigger guard_license before update on public.licenses
    for each row execute function public.guard_license();

-- --------------------------------------------------------------------- RLS --

alter table public.profiles enable row level security;
alter table public.requests enable row level security;
alter table public.licenses enable row level security;
alter table public.license_counter enable row level security;

create policy profiles_read on public.profiles for select to authenticated
    using (id = auth.uid() or public.is_staff());
create policy profiles_update_own on public.profiles for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
    using (public.is_admin_mfa()) with check (public.is_admin_mfa());

create policy requests_read on public.requests for select to authenticated
    using (user_id = auth.uid() or public.is_staff());
create policy requests_insert_own on public.requests for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending' and decided_by is null
                and decided_at is null and license_id is null and decision_note is null);
create policy requests_reject_admin on public.requests for update to authenticated
    using (public.is_admin_mfa()) with check (public.is_admin_mfa());

create policy licenses_read on public.licenses for select to authenticated
    using (user_id = auth.uid() or public.is_staff());
create policy licenses_revoke_admin on public.licenses for update to authenticated
    using (public.is_admin_mfa()) with check (public.is_admin_mfa());

-- Column grants: a user's own-row update may only reach these two columns.
revoke update on public.profiles from authenticated;
grant update (full_name, organization, role) on public.profiles to authenticated;
revoke update on public.requests from authenticated;
grant update (status, decision_note, decided_by, decided_at) on public.requests to authenticated;
revoke update on public.licenses from authenticated;
grant update (status, revoked_reason, revoked_at) on public.licenses to authenticated;
revoke all on public.license_counter from anon, authenticated;
revoke all on public.profiles, public.requests, public.licenses from anon;

-- ------------------------------------------------------------ installers --
-- Private bucket; any signed-in user may create a short-lived download link.
insert into storage.buckets (id, name, public) values ('installers', 'installers', false)
    on conflict (id) do nothing;

create policy installers_read on storage.objects for select to authenticated
    using (bucket_id = 'installers');
