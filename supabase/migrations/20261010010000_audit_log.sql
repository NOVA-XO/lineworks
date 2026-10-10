-- =============================================================================
-- Үйлдлийн бүртгэл (2026-10-10, хамгаалалтын шалгалт S2).
--
-- Лиценз олгодог систем ул мөргүй байж болохгүй: хэн, хэзээ, юуг хийсэн.
-- Бичдэг нь ЗӨВХӨН доорх триггерүүд (security definer). Хэн ч — service_role ч —
-- засах, устгах, хоослох боломжгүй (эрх хасагдсан + триггер хориглоно).
-- Уншдаг нь staff (viewer, admin).
--
-- actor: хөтчөөс бол auth.uid(); Edge Function (service_role) лиценз гаргахад хэн
-- батласныг requests.decided_by-аас авна; SQL Editor (postgres)-оос бол null.
-- =============================================================================

create table public.audit_log (
    id         bigint generated always as identity primary key,
    at         timestamptz not null default now(),
    actor      uuid,
    db_role    text not null,
    action     text not null,
    entity     text not null,
    entity_id  text not null,
    details    jsonb not null default '{}'::jsonb
);

create index on public.audit_log (at desc);
create index on public.audit_log (entity, entity_id);

alter table public.audit_log enable row level security;

create policy audit_read_staff on public.audit_log for select to authenticated
    using (public.is_staff());

revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant select on public.audit_log to service_role;

create function public.audit_immutable() returns trigger
    language plpgsql set search_path = public
as $$
begin
    raise exception 'Үйлдлийн бүртгэлийг өөрчлөх, устгах боломжгүй.';
end $$;

create trigger audit_no_update before update or delete on public.audit_log
    for each row execute function public.audit_immutable();
create trigger audit_no_truncate before truncate on public.audit_log
    for each statement execute function public.audit_immutable();

create function public.audit_write(p_actor uuid, p_action text, p_entity text, p_id text, p_details jsonb)
    returns void
    language sql security definer set search_path = public
as $$
    -- security definer дотор current_user нь эзэмшигч болдог; жинхэнэ дүр нь SET ROLE-оос.
    insert into public.audit_log (actor, db_role, action, entity, entity_id, details)
    values (p_actor, coalesce(nullif(current_setting('role', true), 'none'), session_user::text),
            p_action, p_entity, p_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.audit_write(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- licences --

alter table public.licenses add column revoked_by uuid references public.profiles (id);

create or replace function public.guard_license() returns trigger
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
    new.revoked_by := auth.uid();
    return new;
end $$;

create function public.audit_license() returns trigger
    language plpgsql security definer set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.audit_write(auth.uid(), 'license.issue', 'license', new.id::text,
            jsonb_build_object('no', new.no, 'user_id', new.user_id, 'machine_id', new.machine_id,
                               'edition', new.edition, 'valid_from', new.valid_from,
                               'valid_until', new.valid_until));
    elsif tg_op = 'DELETE' then
        perform public.audit_write(auth.uid(), 'license.delete', 'license', old.id::text,
            jsonb_build_object('no', old.no, 'user_id', old.user_id, 'edition', old.edition));
    elsif new.status is distinct from old.status then
        perform public.audit_write(coalesce(new.revoked_by, auth.uid()), 'license.' || new.status,
            'license', new.id::text,
            jsonb_build_object('no', new.no, 'from', old.status, 'reason', new.revoked_reason));
    end if;
    return null;
end $$;

create trigger audit_license after insert or update or delete on public.licenses
    for each row execute function public.audit_license();

-- ---------------------------------------------------------------- requests --

create function public.audit_request() returns trigger
    language plpgsql security definer set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.audit_write(coalesce(auth.uid(), new.user_id), 'request.create', 'request',
            new.id::text,
            jsonb_build_object('kind', new.kind, 'machine_id', new.machine_id,
                               'renews_license', new.renews_license));
    elsif new.status is distinct from old.status then
        perform public.audit_write(coalesce(new.decided_by, auth.uid()), 'request.' || new.status,
            'request', new.id::text,
            jsonb_build_object('user_id', new.user_id, 'license_id', new.license_id,
                               'note', new.decision_note));
    end if;
    return null;
end $$;

create trigger audit_request after insert or update on public.requests
    for each row execute function public.audit_request();

-- ---------------------------------------------------------------- profiles --

create function public.audit_profile() returns trigger
    language plpgsql security definer set search_path = public
as $$
begin
    if new.role is distinct from old.role then
        perform public.audit_write(auth.uid(), 'profile.role', 'profile', new.id::text,
            jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
    end if;
    return null;
end $$;

create trigger audit_profile after update on public.profiles
    for each row execute function public.audit_profile();

revoke execute on function
    public.audit_license(), public.audit_request(), public.audit_profile(), public.audit_immutable()
    from public, anon, authenticated;
