// Disposable loopback proof only. The actual production admission handler,
// credential hashing, response allowlist and SQL redemption are exercised.
// Synthetic JWT verification replaces hosted GoTrue, never admission truth.
import { createTicketAdmissionHandler } from '../../../../supabase/functions/ticket-admission/index.ts';
const secret = new TextEncoder().encode('organizer-ops-local-only-jwt-secret-2026');
const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function serviceToken() {
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', exp: Math.floor(Date.now()/1000)+3600 })}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `${body}.${btoa(String.fromCharCode(...signature)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}`;
}
const handler = createTicketAdmissionHandler({
  appOrigin: 'http://127.0.0.1:3012',
  async verifyOrganizer(request) {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) throw new Error('Unauthenticated');
    const raw = Uint8Array.from(atob(signature.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC', key, raw, new TextEncoder().encode(`${header}.${body}`))) throw new Error('Unauthenticated');
    const claims = JSON.parse(atob(body.replaceAll('-','+').replaceAll('_','/')));
    if (claims.role !== 'authenticated' || claims.exp <= Date.now()/1000 || typeof claims.sub !== 'string') throw new Error('Unauthenticated');
    return { userId: claims.sub, organizerId: claims.sub };
  },
  async redeem(input) {
    const response = await fetch('http://127.0.0.1:55436/rpc/server_redeem_organizer_ticket', {
      method: 'POST', headers: { authorization: `Bearer ${await serviceToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_organizer_id: input.organizerId, p_event_id: input.eventId, p_credential_hash: input.credentialHash }),
    });
    if (!response.ok) throw new Error('Admission unavailable');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Admission unavailable');
    return rows[0];
  },
});
Deno.serve({ hostname: '127.0.0.1', port: 55437 }, request => new URL(request.url).pathname === '/health' ? new Response('local admission proof') : handler(request));
