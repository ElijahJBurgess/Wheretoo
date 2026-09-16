#!/usr/bin/env python3
"""Verify real local SQL through production discovery and RSVP handlers; no providers."""
import json,urllib.request,uuid,base64,os
BASE='http://127.0.0.1:55567';ORIGIN='http://127.0.0.1:3033'
def post(path,body):
 r=urllib.request.urlopen(urllib.request.Request(BASE+path,data=json.dumps(body).encode(),headers={'Origin':ORIGIN,'Content-Type':'application/json'}));return json.loads(r.read())
q={'region':'sf_bay_area','when':'upcoming'}
p1=post('/functions/v1/public-discovery',q);assert len(p1['items'])==20 and p1['nextCursor']
p2=post('/functions/v1/public-discovery',{**q,'cursor':p1['nextCursor']});assert len(p2['items'])==20
assert not {x['id'] for x in p1['items']}&{x['id'] for x in p2['items']}
assert all(x['admission']=={'state':'unknown','minimumBuyerAmountMinor':None,'currency':None} and x['artworkReference'] is None for x in p1['items'])
free=next(x for x in p1['items'] if x['admissionType']=='free');paid=next(x for x in p1['items'] if x['admissionType']=='paid')
assert post('/rest/v1/rpc/get_public_free_rsvp',{'p_event_id':free['id']})
assert post('/rest/v1/rpc/get_public_event_ticketing',{'p_event_id':paid['id']})
bearer='rsvp_'+base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')
request_id=str(uuid.uuid4())
body={'eventId':free['id'],'quantity':1,'name':'Disposable Proof','email':'spec13-proof@example.invalid','requestId':request_id,'collectionBearer':bearer}
confirmed=post('/functions/v1/free-rsvp',body);assert confirmed['kind']=='confirmed'
replayed=post('/functions/v1/free-rsvp',body);assert replayed==confirmed
assert post('/functions/v1/free-rsvp-status',{'requestId':request_id,'collectionBearer':bearer})==confirmed
collection=post('/functions/v1/ticket-collection',{'collectionBearer':bearer});assert collection['kind']=='ready'
print('PASS: real eligible discovery pages, stable cursor, neutral summaries, actual free/paid public reads, free registration retry/status/private collection through owning handlers.')
