-- Explicit synthetic task profile only. No organizer/event/order/ticket fixtures.
-- Run through spec14-local.py prepare-scenarios after unchanged migration replay.
begin;
select private.configure_policy_environment('development');
update private.checkout_runtime_control set checkout_creation_enabled=true;
update private.ticket_email_settings set
  enabled_at=coalesce(enabled_at,clock_timestamp()),
  worker_enabled=true,
  limits='{
    "recovery_recipient":[{"seconds":60,"max":1},{"seconds":3600,"max":3},{"seconds":86400,"max":5}],
    "recovery_ip":[{"seconds":900,"max":60},{"seconds":3600,"max":300},{"seconds":86400,"max":1000}],
    "resend_recipient":[{"seconds":60,"max":1},{"seconds":3600,"max":3},{"seconds":86400,"max":5}],
    "resend_source":[{"seconds":60,"max":1},{"seconds":3600,"max":3},{"seconds":86400,"max":5}],
    "resend_actor":[{"seconds":3600,"max":30}],"resend_event":[{"seconds":3600,"max":60}],
    "verified_grant":[{"seconds":60,"max":60}],"access_ip":[{"seconds":60,"max":6000}],
    "invalid_access_ip":[{"seconds":60,"max":120}]
  }'::jsonb;
update cron.job set active=false;
commit;
