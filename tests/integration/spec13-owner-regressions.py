#!/usr/bin/env python3
"""Existing owner SQL regressions, routed only through the guarded Spec13 runner."""
import pathlib,subprocess,json
ROOT=pathlib.Path(__file__).resolve().parents[2]
files=['public_eligibility_projections','moderation_publish_eligibility','moderation_published_edits','organizers_events_rls','ticketing_rls','inventory_reservations','payment_fulfillment','core_ticket_truth_lite_fulfillment','core_ticket_truth_lite_collection','core_ticket_truth_lite_redemption','core_ticket_truth_lite_lifecycle','free_registration_behavior','free_registration_security','free_registration_integrity','free_registration_lifecycle','spec07_email_behavior','spec07_email_recovery','spec07_email_access_limits','spec08_checkout_expiry','spec09_refund_lifecycle','spec09_refund_operations','spec09_refund_notice_access','spec10_cancellation_summary','spec10_status_access_security','spec10_private_collection_facts','spec10_spec11_integration','spec11_settings']
results=[]
for name in files:
 result=subprocess.run(['python3',str(ROOT/'tests/integration/spec13-database.py'),'test',f'supabase/tests/database/{name}.test.sql'],cwd=ROOT,text=True,capture_output=True)
 print(result.stdout);print(result.stderr)
 results.append({'suite':name,'passed':result.returncode==0})
(ROOT/'.superpowers/spec13/backend-owner-regressions.json').write_text(json.dumps(results,indent=2)+'\n')
print('SUMMARY:',sum(r['passed'] for r in results),'passed;',sum(not r['passed'] for r in results),'failed')
raise SystemExit(any(not r['passed'] for r in results))
