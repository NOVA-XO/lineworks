-- =============================================================================
-- Admins: at most TWO, and made or unmade only by the database owner (owner, 2026-10-14).
--
-- Until now an MFA-verified admin could make any account an admin from the browser, with
-- no limit. One stolen admin session was therefore enough to demote the other admin and
-- promote an account of the attacker's own. Now:
--
--   1. No browser session and no edge function can give, take, move or delete the admin
--      role — not even an admin's. Only the owner (Supabase SQL editor / CLI, behind the
--      Supabase account's own login and 2FA) can. Viewer and user changes stay with the
--      MFA admin as before.
--   2. Never more than two admins, for everyone including the owner. A new admin takes a
--      seat that was freed first: demote one, then promote the other.
--
-- THE CAP IS A CONSTRAINT, NOT A COUNT. Each admin holds seat 1 or 2; the seat is unique
-- and «admin ⇔ has a seat» is a CHECK. A count under a lock can be fooled by a
-- REPEATABLE READ transaction counting from an old snapshot (Astra, 2026-10-14); a unique
-- index cannot, and it holds even with the trigger disabled.
-- =============================================================================

alter table public.profiles
    add column admin_seat smallint unique check (admin_seat in (1, 2));

-- The two admins of today, in the order they were made.
with seated as (
    select id, row_number() over (order by created_at, id) as seat
    from public.profiles where role = 'admin'
)
update public.profiles p set admin_seat = s.seat from seated s where p.id = s.id;

alter table public.profiles
    add constraint profiles_admin_has_seat check ((role = 'admin') = (admin_seat is not null));

create function public.admin_cap() returns integer
    language sql immutable as $$ select 2 $$;

-- WHO may touch an admin row. A separate trigger from guard_profile on purpose: that one
-- lets service_role through, and this must not. SECURITY INVOKER, so current_user is the
-- caller and not this function's owner (the trap guard_profile records).
create function public.guard_admin_role() returns trigger
    language plpgsql security invoker set search_path = public
as $$
declare
    owner_call constant boolean := current_user = 'postgres';
    was_admin constant boolean := tg_op <> 'INSERT' and old.role = 'admin';
begin
    if tg_op = 'DELETE' then
        if was_admin and not owner_call then
            raise exception 'Админы профайлыг зөвхөн сангийн эзэн устгана — эхлээд эрхийг нь хасна.';
        end if;
        return old;
    end if;

    if not owner_call then
        -- Nothing about an admin row, or about becoming one, from anywhere but the owner:
        -- not the role, not the seat, and not the id — moving an admin row to another
        -- account would carry the role with it while leaving it unchanged.
        if new.role = 'admin' and not was_admin then
            raise exception 'Админ эрхийг зөвхөн сангийн эзэн олгож, хасна.';
        end if;
        if was_admin and (new.role <> 'admin' or new.id <> old.id) then
            raise exception 'Админ эрхийг зөвхөн сангийн эзэн олгож, хасна.';
        end if;
        if new.admin_seat is distinct from (case when tg_op = 'INSERT' then null else old.admin_seat end) then
            raise exception 'Админ эрхийг зөвхөн сангийн эзэн олгож, хасна.';
        end if;
        return new;
    end if;

    -- The owner: seat the new admin, unseat the old one. The unique index is the guard;
    -- choosing the seat here only gives the owner a clear message instead of a key error.
    if new.role = 'admin' and new.admin_seat is null then
        perform pg_advisory_xact_lock(hashtext('zlw-admin-cap'));
        select min(s) into new.admin_seat
        from generate_series(1, public.admin_cap()) s
        where s not in (select admin_seat from public.profiles
                        where admin_seat is not null and id <> new.id);
        if new.admin_seat is null then
            raise exception 'Админ % хүрсэн: эхлээд нэгийг нь хасна уу.', public.admin_cap();
        end if;
    elsif new.role <> 'admin' then
        new.admin_seat := null;
    end if;

    return new;
end $$;

create trigger guard_admin_role before insert or update or delete on public.profiles
    for each row execute function public.guard_admin_role();

revoke execute on function public.guard_admin_role(), public.admin_cap() from public, anon, authenticated;
