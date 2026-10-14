-- =============================================================================
-- Issue a licence and decide its request in ONE transaction (Astra's review, 2026-10-14).
--
-- approve-request used to insert the licence, then conditionally mark the request approved,
-- and delete the licence if that update lost a race. Between the two steps the requester
-- could already read and download the signed licence (licenses_read lets owners read their
-- rows) — and an offline licence once copied cannot be taken back. A crash between them
-- left it published for good. Now both happen here, under a row lock on the request, and
-- nothing is visible unless both succeed.
--
-- service_role only: the edge function, which has already checked admin + aal2, signed the
-- licence and computed its dates. The request is re-read here, not trusted from the caller.
-- =============================================================================

create function public.issue_license_for_request(
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

    insert into public.licenses (no, user_id, machine_id, edition, valid_from, valid_until, license_text)
    values (p_no, req.user_id, p_machine_id, p_edition, p_valid_from, p_valid_until, p_license_text)
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
