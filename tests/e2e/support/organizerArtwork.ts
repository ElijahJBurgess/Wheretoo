import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'

// Optional local visual proof only; never bundled as default event artwork.
const artworkPath = process.env.WHERETO_OPERATIONS_ARTWORK_PROOF
export function seedProofArtwork() {
  if (!artworkPath) return
  readFileSync(artworkPath)
  execFileSync('psql', ['postgresql://postgres:organizer_ops_local_only@127.0.0.1:55435/postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c', `
    begin;
    do $$ begin
      if exists (select 1 from auth.users where id not in ('a6100000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000002')) then
        raise exception 'Not a disposable organizer fixture';
      end if;
    end $$;
    set local session_replication_role = replica;
    update public.events set artwork_path = 'https://ops-artwork.supabase.co/storage/v1/object/public/events/rooftop.png'
    where id = 'a6200000-0000-4000-8000-000000000001';
    commit;
  `], { stdio: 'pipe' })
}
export async function serveProofArtwork(page: Page) {
  if (artworkPath) await page.route('https://ops-artwork.supabase.co/storage/v1/object/public/events/rooftop.png', route =>
    route.fulfill({ contentType: 'image/png', body: readFileSync(artworkPath) }))
}
