"""Real competing sessions on the dedicated local publish proof database only."""
import importlib.util
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tests/integration' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


local = load('publish_local', 'public-availability-local.py')
review = load('publish_review_races', 'spec10-event-history-review-concurrency.py')


def verified_container():
    local.verify()
    return local.CONTAINER


review.h.db.verify = verified_container
review.h.db.expand = local.expand
h = review.h


def caught(call):
    return f"""create function pg_temp.try_publish() returns text language plpgsql as $body$
      begin perform {call}; return 'SUCCESS'; exception when sqlstate 'P0001' then return sqlerrm; end; $body$;
      select pg_temp.try_publish()"""


def main():
    local.verify()
    h.main()  # Four unchanged capacity/context serialization contracts.
    review.main()  # Five unchanged direct-edit, disclosure, policy and cancel races.
    for case in ('edit_publish', 'disclosure_publish', 'duplicate_publish', 'policy_publish', 'publish_cancel', 'publish_worker'):
        event, auth, ctx, before = review.fixture()
        token = h.quote(before['context_token'])
        publisher = f'public.publish_event_if_current({h.quote(event)},{token})'
        if case == 'edit_publish':
            payload = {k: v for k, v in before['current_saved']['facts'].items() if k != 'disclosures'}
            payload['title'] = 'Another community gathering'
            first = f"{auth} select public.save_owned_event_revision_if_current('{event}',{h.quote(json.dumps(payload))}::jsonb,{token})"
            second = auth + caught(publisher)
        elif case == 'disclosure_publish':
            payload = {**before['current_saved']['facts']['disclosures'], 'minimum_age': '18_plus'}
            first = f"{auth} select public.save_owned_event_requirements_if_current('{event}',{h.quote(json.dumps(payload))}::jsonb,{token})"
            second = auth + caught(publisher)
        elif case == 'policy_publish':
            first = 'select environment from private.organizer_policy_release_settings where singleton_id for update'
            second = auth + caught(publisher)
        else:
            if case == 'publish_worker':
                # Lease only this fixture's existing queued evaluation. No global
                # worker claim can accidentally consume another fixture's work.
                h.query(f"update private.event_moderation_evaluations set status='processing',attempt_count=1,started_at=clock_timestamp() where event_id='{event}' and status='queued';")
                second = f"select public.server_apply_moderation_evaluation(id,content_revision,input_sha256,queued_moderation_version,'review_required','high',array['other'],null,null) from private.event_moderation_evaluations where event_id='{event}' and status='processing'"
            elif case == 'publish_cancel':
                second = f"{auth} select public.cancel_owned_event('{event}')"
            else:
                second = auth + caught(publisher)
            first = auth + 'select ' + publisher
        finish = "select private.configure_policy_environment('development')" if case == 'policy_publish' else 'select 1'
        result = review.compete(case, first, finish, second)
        after = h.parsed(f'begin; {auth} select {ctx}; commit;')
        if case in ('edit_publish', 'disclosure_publish', 'duplicate_publish', 'policy_publish'):
            assert result.splitlines()[-1] == 'EVENT_CONTEXT_CONFLICT', (case, result)
        if case == 'duplicate_publish':
            assert after['currently_publicly_eligible'] is True
            assert h.query(f"select count(*) from private.event_moderation_actions where event_id='{event}' and action='clear';") == '1'
        elif case == 'publish_cancel':
            assert after['event']['status'] == 'cancelled' and not after['currently_publicly_eligible']
        elif case == 'publish_worker':
            assert result.splitlines()[-1] == 'superseded'
            assert after['event']['moderation_status'] == 'clear' and after['currently_publicly_eligible']
        print('PASS', case, ': waiter observed real lock contention and canonical final state')
    event, auth, ctx, before = review.fixture()
    moderator = str(uuid.uuid4())
    h.query(f"insert into auth.users(id,email) values('{moderator}','hold-{moderator}@example.invalid'); insert into private.staff_roles(user_id,role,active,granted_by) values('{moderator}','moderator',true,'{moderator}');")
    first = auth + f"select public.publish_event_if_current('{event}',{h.quote(before['context_token'])})"
    # A moderator waiting on publication takes a fresh snapshot after the lock.
    second = f"""select id from public.events where id='{event}' for update;
      create temp table current_hold as select id,content_revision,private.compute_event_input_sha256(id) digest,moderation_version from public.events where id='{event}';
      grant select on current_hold to authenticated;
      select set_config('request.jwt.claim.sub','{moderator}',true); set local role authenticated;
      select public.moderate_event(id,content_revision,digest,moderation_version,'hold','user_report',null) from current_hold"""
    review.compete('publish_moderator_hold', first, 'select 1', second)
    after = h.parsed(f'begin; {auth} select {ctx}; commit;')
    assert after['event']['moderation_status'] == 'under_review' and not after['currently_publicly_eligible']
    assert h.query(f"select count(*) from public.get_public_event('{event}');") == '0'
    print('PASS publish_moderator_hold: waiting moderator closes public eligibility immediately after publication')
    print('16 real parallel-session scenarios PASS')


if __name__ == '__main__':
    main()
