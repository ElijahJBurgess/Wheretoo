/** Pure conservative guard: a clock/lease crossing can never admit outside work. */
export type EmailQueueRow = {
  id:string; state:string; dispatch_stopped_reason:string|null; lease_until:string|null;
  dispatch_count:number; first_possible_dispatch_at:string|null;
}
export type EmailWorkerTarget = {outboxId:string;refundOrderId?:never}|{refundOrderId:string;outboxId?:never}
export function assertEmailWorkerPlan(rows:EmailQueueRow[], refundableOrders:string[], target:EmailWorkerTarget) {
  const targetRow=target.outboxId ? rows.find(row=>row.id===target.outboxId) : undefined
  if(rows.some(row=>row.id!==target.outboxId && ['queued','unknown','sending'].includes(row.state) && row.dispatch_stopped_reason===null)) throw new Error('Email worker has outside pending work; separate bounded authorization required')
  if(refundableOrders.some(order=>order!==target.refundOrderId)) throw new Error('Email worker can enqueue an outside refund notice')
  if(target.outboxId && !targetRow) throw new Error('Exact email target missing')
  if(targetRow && (targetRow.state!=='queued'||targetRow.dispatch_count!==0||targetRow.first_possible_dispatch_at!==null||targetRow.lease_until!==null||targetRow.dispatch_stopped_reason!==null)) throw new Error('Email target is not virgin queued work; retain it for explicit readback or reconciliation')
  if(target.refundOrderId && (refundableOrders.length!==1||refundableOrders[0]!==target.refundOrderId)) throw new Error('Exact refund notice candidate missing')
}

export type EmailProofHashes = Record<string,string>
type EmailWorkerProof = {
  status?:string; mode?:string; errorName?:unknown;
  response?:{handlerStatus?:number}; after?:{outboxes?:{id:string;state:string}[]};
  completion?:{outboxId?:string;state?:string;toolHashes?:EmailProofHashes;completedAt?:string}
}
/** A transport response is not proof that the subsequent preservation checks passed. */
export function assertCompletedEmailWorker(steps:EmailWorkerProof[]|undefined,outboxId:string,state:string,hashes:EmailProofHashes,required:boolean) {
  if(!steps?.length&&!required)return
  const step=steps?.at(-1), done=step?.completion
  if(step?.status!=='completed'||step.errorName||step.response?.handlerStatus!==200||!done?.completedAt)throw new Error('Email worker preservation proof was not completed; prior attempt remains failed or incomplete')
  if(done.outboxId!==outboxId||done.state!==state||!step.after?.outboxes?.some(row=>row.id===outboxId&&row.state===state))throw new Error('Completed email proof target differs')
  if(step.mode!==(state==='failed'?'failed':'accepted'))throw new Error('Completed email proof mode differs')
  const keys=Object.keys(hashes).sort(), previous=Object.keys(done.toolHashes??{}).sort()
  if(JSON.stringify(keys)!==JSON.stringify(previous)||keys.some(key=>done.toolHashes?.[key]!==hashes[key]))throw new Error('Completed email proof source/helper binding differs; independent review required')
}
export function retainedRefundId(canonical:string|null,retained:string|undefined,newIds:string[]):string {
  if(canonical&&retained&&canonical!==retained)throw new Error('Canonical refund ID conflicts with retained original; no adoption or provider action allowed')
  if(retained)return retained
  if(canonical)return canonical
  if(newIds.length!==1)throw new Error('Original provider refund identity is ambiguous; no replacement allowed')
  return newIds[0]
}
