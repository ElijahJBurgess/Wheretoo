/** Real local Storage + committed SQL, with only the final response discarded. */
import { duplicateEvent, DuplicateError, type FinalizeArgs } from '../../../supabase/functions/duplicate-event/duplicateEvent.ts';
const base = Deno.env.get('DUPLICATE_API')!;
if (base !== 'http://127.0.0.1:58321') throw new Error('Dedicated local stack required');
const token = Deno.env.get('DUPLICATE_TOKEN')!, service = Deno.env.get('DUPLICATE_SERVICE')!;
const source = Deno.env.get('DUPLICATE_SOURCE')!, owner = Deno.env.get('DUPLICATE_OWNER')!;
async function request(path: string, auth: string, body?: string | Uint8Array, headers = {}, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { apikey: service, Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...headers }, body: body as BodyInit });
  if (!response.ok) throw new Error(`Local request failed: ${response.status} ${await response.text()}`);
  return response;
}
async function rpc(name: string, args: unknown) { return (await request('/rest/v1/rpc/' + name, token, JSON.stringify(args))).json(); }
let committed: FinalizeArgs | undefined;
let cleanupCalls = 0;
try {
  await duplicateEvent({
    context: () => rpc('get_owned_event_duplicate_context', { p_source_event_id: source }),
    read: async path => (await request('/storage/v1/object/authenticated/event-images/' + path, service, undefined, {}, 'GET')).blob(),
    stage: async (path, bytes, mime, metadata) => { await request('/storage/v1/object/event-images/' + path, service, bytes, { 'Content-Type': mime, 'x-metadata': btoa(JSON.stringify(metadata)) }); },
    finalize: async args => {
      const result = await rpc('duplicate_owned_event', args);
      if (result !== args.p_new_event_id) throw new Error('Unexpected commit');
      committed = args;
      throw new Error('Deliberately discarded committed response');
    },
    remove: () => { cleanupCalls++; throw new Error('Cleanup must never execute'); },
  }, source, owner);
  throw new Error('Expected unknown result');
} catch (error) {
  if (!(error instanceof DuplicateError) || error.message !== 'DUPLICATE_OUTCOME_UNKNOWN') throw error;
}
if (!committed || cleanupCalls) throw new Error('Commit/cleanup proof failed');
const cover = await rpc('get_event_cover_state', { p_event_id: committed.p_new_event_id });
if (cover.images[0]?.path !== committed.p_staged_path) throw new Error('Committed attachment lost');
const bytes = await request('/storage/v1/object/authenticated/event-images/' + committed.p_staged_path, service, undefined, {}, 'GET');
if (!(await bytes.arrayBuffer()).byteLength) throw new Error('Committed pixels lost');
console.log('PASS real committed response loss preserves attachment and Storage bytes; cleanup calls=0');
