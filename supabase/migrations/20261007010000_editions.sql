-- =============================================================================
-- Editions (owner, 2026-10-07): trial · subscription (365 days) · prime (perpetual).
-- Prime is capped at TEN EVER ISSUED — a revoked prime still counts, because a licence
-- checked offline keeps working after it is revoked and its seat is never really free.
-- The cap is enforced here, under a lock, so two admins approving at once cannot make
-- an eleventh. 'full' stays valid for licences issued before this migration.
-- =============================================================================

alter table public.licenses drop constraint if exists licenses_edition_check;
alter table public.licenses add constraint licenses_edition_check
    check (edition in ('trial', 'full', 'subscription', 'prime'));

create function public.prime_cap() returns integer
    language sql immutable as $$ select 10 $$;

create function public.guard_prime() returns trigger
    language plpgsql security definer set search_path = public
as $$
begin
    if new.edition <> 'prime' then
        return new;
    end if;
    perform pg_advisory_xact_lock(hashtext('zlw-prime-cap'));
    if (select count(*) from public.licenses where edition = 'prime') >= public.prime_cap() then
        raise exception 'Prime лиценз дууссан: % ширхэгээс бүгд олгогдсон.', public.prime_cap();
    end if;
    return new;
end $$;

create trigger guard_prime before insert on public.licenses
    for each row execute function public.guard_prime();

-- Seats left, for the admin page. Staff only; a user has no reason to know.
create function public.prime_remaining() returns integer
    language plpgsql stable security definer set search_path = public
as $$
begin
    if not public.is_staff() then
        raise exception 'Эрх хүрэхгүй.';
    end if;
    return public.prime_cap() - (select count(*) from public.licenses where edition = 'prime');
end $$;

revoke execute on function public.prime_remaining() from public, anon;
grant execute on function public.prime_remaining() to authenticated;
