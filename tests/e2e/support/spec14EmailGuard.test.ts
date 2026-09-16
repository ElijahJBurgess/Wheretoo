import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertEmailWorkerPlan, assertCompletedEmailWorker, retainedRefundId, type EmailQueueRow } from './spec14EmailGuard'
const row = (id='target', extra:Partial<EmailQueueRow>={}):EmailQueueRow => ({id,state:'queued',dispatch_stopped_reason:null,lease_until:null,dispatch_count:0,first_possible_dispatch_at:null,...extra})
test('one exact virgin target can be claimed',()=>assert.doesNotThrow(()=>assertEmailWorkerPlan([row()],[],{outboxId:'target'})))
test('unknown future outside row is refused without predicting its clock',()=>assert.throws(()=>assertEmailWorkerPlan([row(),row('outside',{state:'unknown'})],[],{outboxId:'target'}),/outside/))
test('outside leased sending is refused',()=>assert.throws(()=>assertEmailWorkerPlan([row(),row('outside',{state:'sending',lease_until:'future'})],[],{outboxId:'target'}),/outside/))
test('outside exhausted stopped rows do not become claims',()=>assert.doesNotThrow(()=>assertEmailWorkerPlan([row(),row('outside',{state:'unknown',dispatch_stopped_reason:'retry_window_exhausted'})],[],{outboxId:'target'})))
test('outside unmaterialized refund notice is refused',()=>assert.throws(()=>assertEmailWorkerPlan([row()],['outside-order'],{outboxId:'target'}),/refund/))
test('only exact eligible target refund may be materialized',()=>assert.doesNotThrow(()=>assertEmailWorkerPlan([],['order'],{refundOrderId:'order'})))
test('missing target without a materializable refund is refused',()=>assert.throws(()=>assertEmailWorkerPlan([],[],{outboxId:'missing'}),/missing/))
test('target with prior dispatch cannot silently retry',()=>assert.throws(()=>assertEmailWorkerPlan([row('target',{state:'unknown',dispatch_count:1})],[],{outboxId:'target'}),/virgin/))
test('target lease blocks the invocation',()=>assert.throws(()=>assertEmailWorkerPlan([row('target',{lease_until:'future'})],[],{outboxId:'target'}),/virgin/))
test('terminal target requires explicit readback rather than a worker call',()=>assert.throws(()=>assertEmailWorkerPlan([row('target',{state:'accepted',dispatch_count:1})],[],{outboxId:'target'}),/virgin/))

const hashes={spec:'spec-bytes',guard:'guard-bytes',harness:'harness-bytes'}
const completeStep=(state='failed')=>({status:'completed',mode:state==='failed'?'failed':'accepted',response:{handlerStatus:200},after:{outboxes:[{id:'target',state}]},completion:{outboxId:'target',state,toolHashes:hashes,completedAt:'recorded'}})
test('response and target state without preservation completion cannot resume',()=>assert.throws(()=>assertCompletedEmailWorker([{mode:'failed',response:{handlerStatus:200},after:{outboxes:[{id:'target',state:'failed'}]}}],'target','failed',hashes,true),/completed/))
test('successful preservation proof with exact byte binding can resume',()=>assert.doesNotThrow(()=>assertCompletedEmailWorker([completeStep()],'target','failed',hashes,true)))
test('changed source/helper bytes reject prior completion',()=>assert.throws(()=>assertCompletedEmailWorker([completeStep()],'target','failed',{...hashes,guard:'changed'},true),/binding/))
test('last incomplete attempt cannot fall back to earlier completion',()=>assert.throws(()=>assertCompletedEmailWorker([completeStep(),{status:'running'}],'target','failed',hashes,true),/completed/))
for(const state of ['accepted','suppressed']) {
 test(state+' canonical state cannot bypass a prior failed worker proof',()=>assert.throws(()=>assertCompletedEmailWorker([{status:'failed'}],'target',state,hashes,false),/completed/))
 test(state+' state without any local worker attempt stays ordinary readback',()=>assert.doesNotThrow(()=>assertCompletedEmailWorker(undefined,'target',state,hashes,false)))
}
test('failed state without any controlled worker proof fails closed',()=>assert.throws(()=>assertCompletedEmailWorker(undefined,'target','failed',hashes,true),/completed/))
test('different completed target cannot authenticate current outbox',()=>assert.throws(()=>assertCompletedEmailWorker([completeStep()],'different','failed',hashes,true),/target/))
test('canonical refund ID conflict retains original and rejects adoption',()=>assert.throws(()=>retainedRefundId('replacement','original',[]),/conflict/))
test('same canonical and retained refund ID is stable',()=>assert.equal(retainedRefundId('original','original',[]),'original'))
test('missing attachment retains provider-only original ID',()=>assert.equal(retainedRefundId(null,'original',['unrelated']),'original'))
test('ambiguous provider-only new IDs fail closed',()=>assert.throws(()=>retainedRefundId(null,undefined,['one','two']),/ambiguous/))
