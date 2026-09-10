import type Stripe from "stripe";
import { getServiceClient } from "../_shared/database.ts";
import { createWholeOrderRefund } from "../_shared/refundOrder.ts";
import { getStripe, rejectLiveStripeObject } from "../_shared/stripeClient.ts";

// Provider plumbing for the existing engine. Its snapshot, idempotency key,
// amount and transfer/fee policy remain the sole refund authority.
export async function refundOwnedOrder(orderId: string): Promise<void> {
 const stripe = getStripe();
 await createWholeOrderRefund(orderId,"requested_by_customer",{
  async prepareWholeOrderRefund(id,reason) {
   const {data,error}=await getServiceClient().rpc("server_prepare_whole_order_refund",{p_order_id:id,p_reason:reason});
   if(error || !Array.isArray(data) || data.length!==1) throw new Error("Refund unavailable");
   const row=data[0];
   return {orderId:row.order_id,paymentIntentId:row.payment_intent_id,chargeId:row.charge_id,transferId:row.transfer_id,applicationFeeId:row.application_fee_id,currency:row.currency,totalMinor:row.total_minor,applicationFeeAmountMinor:row.application_fee_amount_minor,reason:row.reason};
  },
  async createRefund(params,options) { return rejectLiveStripeObject(await stripe.refunds.create(params as Stripe.RefundCreateParams,options)); },
  async retrieveRefundEvidence(refundId,snapshot) {
   const transfer=rejectLiveStripeObject(await stripe.transfers.retrieve(snapshot.transferId,{expand:["reversals"]}));
   const reversal=transfer.reversals.data.find(value=>(typeof value.source_refund==='string'?value.source_refund:value.source_refund?.id)===refundId);
   rejectLiveStripeObject(await stripe.applicationFees.retrieve(snapshot.applicationFeeId));
   const refunds=await stripe.applicationFees.listRefunds(snapshot.applicationFeeId,{limit:10});
   const fee=refunds.data.length===1 && !refunds.has_more ? refunds.data[0]:undefined;
   if(!reversal || reversal.object!=="transfer_reversal" || !fee || fee.object!=="fee_refund" || fee.currency!==snapshot.currency || (typeof fee.fee==='string'?fee.fee:fee.fee.id)!==snapshot.applicationFeeId) throw new Error("Refund evidence unavailable");
   return {transferReversalId:reversal.id,transferReversalAmountMinor:reversal.amount,applicationFeeRefundId:fee.id,applicationFeeRefundAmountMinor:fee.amount};
  },
  async updateRefundMetadata(id,metadata) { rejectLiveStripeObject(await stripe.refunds.update(id,{metadata})); },
 });
}
