-- =============================================================================
-- Licence v3: a request carries the computer's TPM public key (2026-10-14).
--
-- The licence's data key is now encrypted to an RSA key the computer's TPM holds and will
-- not export, so the issuer needs that public key, not just the 16-digit identifier. The
-- identifier stays (it is what people read out and what the admin page shows); the edge
-- function checks it is the fingerprint of this key before signing anything.
--
-- machine_key is the SubjectPublicKeyInfo in base64url, without the «ZLWK1.» prefix of the
-- request code. Rows from before this migration have none; the edge function refuses them
-- and they are re-requested from the new plug-in.
-- =============================================================================

alter table public.requests
    add column machine_key text check (
        char_length(machine_key) between 300 and 1400 and machine_key ~ '^[A-Za-z0-9_-]+$');
-- Length apart from the pattern: a PostgreSQL regex bound may not exceed 255, and
-- '{300,1400}' fails on every row (found by the PGlite test, 2026-10-14).

-- A PENDING request must carry the key — that is the only state in which it is still to be
-- issued. Decided rows are history and may stay without one, and an old pending row (there
-- are none on 2026-10-14) could still be rejected, because rejecting takes it out of the rule.
alter table public.requests
    add constraint requests_pending_need_key check (machine_key is not null or status <> 'pending');
