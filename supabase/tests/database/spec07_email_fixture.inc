\ir free_registration_fixture.inc
-- Synthetic local-only test profile. This is not production approval or activation.
update private.ticket_email_settings set enabled_at=now()-interval '1 minute',worker_enabled=true,limits='{
 "recovery_recipient":[{"seconds":60,"max":1},{"seconds":3600,"max":3},{"seconds":86400,"max":5}],
 "recovery_ip":[{"seconds":900,"max":60},{"seconds":3600,"max":300},{"seconds":86400,"max":1000}],
 "resend_recipient":[{"seconds":60,"max":1},{"seconds":3600,"max":3},{"seconds":86400,"max":5}],
 "resend_source":[{"seconds":60,"max":1},{"seconds":3600,"max":3},{"seconds":86400,"max":5}],
 "resend_actor":[{"seconds":3600,"max":30}],"resend_event":[{"seconds":3600,"max":60}],
 "verified_grant":[{"seconds":60,"max":60}],"access_ip":[{"seconds":60,"max":6000}],"invalid_access_ip":[{"seconds":60,"max":120}]
}'::jsonb;
create function pg_temp.envelope() returns jsonb language sql as $$ select '{"version":1,"keyId":"local","nonce":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA"}'::jsonb $$;
create function pg_temp.email_claim() returns jsonb language sql as $$ select public.server_claim_ticket_email() $$;
