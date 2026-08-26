-- The canonical create snapshot is write-once after reserve_checkout binds
-- its tier-aware digest. Operational lifecycle fields remain mutable.
create or replace function private.populate_checkout_request_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.stripe_checkout_request_digest <> repeat('0', 64)
      and (
        new.event_id is distinct from old.event_id
        or new.organizer_id is distinct from old.organizer_id
        or new.livemode is distinct from old.livemode
        or new.checkout_expires_at is distinct from old.checkout_expires_at
        or new.buyer_email is distinct from old.buyer_email
        or new.client_request_id is distinct from old.client_request_id
        or new.confirmation_token_hash is distinct from old.confirmation_token_hash
        or new.quantity is distinct from old.quantity
        or new.currency is distinct from old.currency
        or new.subtotal_minor is distinct from old.subtotal_minor
        or new.application_fee_amount_minor is distinct from old.application_fee_amount_minor
        or new.stripe_destination_account_id is distinct from old.stripe_destination_account_id
        or new.stripe_checkout_integration_identifier is distinct from old.stripe_checkout_integration_identifier
        or new.stripe_checkout_request_digest is distinct from old.stripe_checkout_request_digest
      ) then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_SNAPSHOT_IMMUTABLE';
    end if;
    return new;
  end if;

  select accounts.stripe_account_id into new.stripe_destination_account_id
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = new.organizer_id
    and accounts.livemode = false;

  new.stripe_destination_account_id := coalesce(
    new.stripe_destination_account_id,
    'acct_unavailable_snapshot'
  );
  new.checkout_expires_at := date_trunc('minute', statement_timestamp())
    + interval '31 minutes';
  new.reservation_expires_at := new.checkout_expires_at + interval '5 minutes';
  new.stripe_checkout_integration_identifier :=
    private.checkout_integration_identifier(new.id);
  new.stripe_checkout_request_digest := repeat('0', 64);
  return new;
end;
$$;

revoke all on function private.populate_checkout_request_snapshot()
from public, anon, authenticated, service_role;
