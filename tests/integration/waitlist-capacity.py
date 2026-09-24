#!/usr/bin/env python3
"""Separate-connection restock budget and independent provider-capacity debits."""
import importlib.util,json,uuid,concurrent.futures
from pathlib import Path
s=importlib.util.spec_from_file_location('r',Path(__file__).with_name('waitlist-dispatch-races.py'));r=importlib.util.module_from_spec(s);s.loader.exec_module(r);p=r.p;c=r.c;check=c.check

def main():
 p.enable();f=p.seed();p.sql(c.join(f))
 p.sql(f"update public.ticket_tiers set quantity_total=3 where id='{f['tier']}';insert into private.waitlist_availability_cycles(tier_id,sequence,opened_at,completed_at) select '{f['tier']}',n,clock_timestamp()-interval '1 hour',clock_timestamp() from generate_series(1,3)n;update private.waitlist_tier_state set cycle=3,observed_state='available' where tier_id='{f['tier']}';insert into private.waitlist_deliveries(enrollment_id,purpose,cycle_id,state,first_possible_dispatch_at,dispatch_count) select w.id,'restock',cy.id,'unknown',clock_timestamp()-interval '1 hour',1 from private.waitlist_enrollments w join private.waitlist_availability_cycles cy on cy.tier_id=w.tier_id where w.event_id='{f['event']}' and cy.sequence<3;insert into private.waitlist_deliveries(enrollment_id,purpose,cycle_id) select w.id,'restock',cy.id from private.waitlist_enrollments w join private.waitlist_availability_cycles cy on cy.tier_id=w.tier_id where w.event_id='{f['event']}' and cy.sequence=3;")
 attempt,lease,_=r.prepare(f,'restock');query=f"select public.server_begin_waitlist_dispatch('{attempt}','{lease}') is not null;"
 with concurrent.futures.ThreadPoolExecutor(2) as pool:out=list(pool.map(p.sql,[query,query]))
 check(sum(x.strip()=='t' for x in out)==1,'concurrent restock workers allow one third possible dispatch')
 check(p.sql(f"select count(*) from private.waitlist_deliveries d join private.waitlist_enrollments w on w.id=d.enrollment_id where w.event_id='{f['event']}' and purpose='restock' and first_possible_dispatch_at>clock_timestamp()-interval '24 hours';").strip()=='3','Unknown plus current concurrent dispatch consume exactly three slots')
 p.sql(f"insert into private.waitlist_availability_cycles(tier_id,sequence) values('{f['tier']}',4);update private.waitlist_tier_state set cycle=4 where tier_id='{f['tier']}';insert into private.waitlist_deliveries(enrollment_id,purpose,cycle_id) select w.id,'restock',cy.id from private.waitlist_enrollments w join private.waitlist_availability_cycles cy on cy.tier_id=w.tier_id where w.event_id='{f['event']}' and cy.sequence=4;")
 check(p.sql(f"select private.waitlist_delivery_reason(d.id) from private.waitlist_deliveries d join private.waitlist_availability_cycles cy on cy.id=d.cycle_id where cy.tier_id='{f['tier']}' and cy.sequence=4;").strip()=='restock_limit','later fourth cycle cannot bypass concurrent daily budget')
 # Capacity is global within Waitlist, separate from transactional and organizer budgets.
 before=p.sql("select (select count(*) from private.ticket_email_rate_events)||','||(select count(*) from private.organizer_message_rate_events);")
 one=p.seed();two=p.seed();p.sql(c.join(one)+c.join(two));a=r.prepare(one);b=r.prepare(two)
 used=int(p.sql("select count(*) from private.waitlist_rate_events where lane='dispatch' and at>clock_timestamp()-interval '1 minute';").strip())
 p.sql(f"select public.server_configure_waitlist('{{\"capacityMinute\":{used+1}}}');")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:out=list(pool.map(p.sql,[f"select public.server_begin_waitlist_dispatch('{x[0]}','{x[1]}') is not null;" for x in [a,b]]))
 check(sum(x.strip()=='t' for x in out)==1,'two events race for one remaining Waitlist provider slot')
 check(p.sql("select (select count(*) from private.ticket_email_rate_events)||','||(select count(*) from private.organizer_message_rate_events);")==before,'Waitlist consumes neither ticket nor organizer-message budgets')
 p.enable();(p.ROOT/'.superpowers/waitlist-proof/capacity.json').write_text(json.dumps(c.results,indent=2))
if __name__=='__main__':main()
