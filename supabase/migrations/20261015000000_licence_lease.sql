-- =============================================================================
-- Online licence check: a 7-day lease (owner, 2026-10-15).
--
-- The plug-in now asks the server at least once in 7 days for a signed lease, proving with
-- its TPM key that it is the computer the licence was issued to. A revoked licence therefore
-- stops within 7 days instead of never, and the server's clock replaces the computer's.
--
-- The server needs the licence's TPM public key to set that proof: it is stored on the
-- licence (until now it lived only on the request). last_lease_at says when the computer
-- last checked in — the only thing the check records.
-- =============================================================================

alter table public.licenses
    add column machine_key text check (
        char_length(machine_key) between 300 and 1400 and machine_key ~ '^[A-Za-z0-9_-]+$'),
    add column last_lease_at timestamptz;

-- Licences issued through the portal carry their request's key.
update public.licenses l
set machine_key = r.machine_key
from public.requests r
where r.license_id = l.id and r.machine_key is not null and l.machine_key is null;

-- From now on the issuing transaction copies it too.
create or replace function public.issue_license_for_request(
    p_request_id    bigint,
    p_decided_by    uuid,
    p_no            text,
    p_machine_id    text,
    p_edition       text,
    p_valid_from    date,
    p_valid_until   date,
    p_license_text  text)
returns table (license_id bigint, license_no text, valid_from date, valid_until date)
    language plpgsql security definer set search_path = public
as $$
declare
    req     public.requests%rowtype;
    new_id  bigint;
begin
    select * into req from public.requests where id = p_request_id for update;
    if not found then
        raise exception 'Хүсэлт олдсонгүй.' using errcode = 'ZL404';
    end if;
    if req.status <> 'pending' then
        raise exception 'Хүсэлт энэ хооронд шийдэгдсэн.' using errcode = 'ZL409';
    end if;
    if req.machine_id <> p_machine_id then
        raise exception 'Компьютерийн дугаар хүсэлтийнхтэй таарахгүй байна.' using errcode = 'ZL409';
    end if;

    insert into public.licenses (no, user_id, machine_id, machine_key, edition, valid_from, valid_until, license_text)
    values (p_no, req.user_id, p_machine_id, req.machine_key, p_edition, p_valid_from, p_valid_until, p_license_text)
    returning id into new_id;

    update public.requests
    set status = 'approved', decided_by = p_decided_by, decided_at = now(), license_id = new_id
    where id = p_request_id;

    return query select new_id, p_no, p_valid_from, p_valid_until;
end $$;

revoke execute on function public.issue_license_for_request(bigint, uuid, text, text, text, date, date, text)
    from public, anon, authenticated;
grant execute on function public.issue_license_for_request(bigint, uuid, text, text, text, date, date, text)
    to service_role;
