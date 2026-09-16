import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { usePublicEventImages } from './publicEventImages'
afterEach(()=>vi.unstubAllGlobals())
it('loads public images without organizer session context or credentials',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>[{id:'15150000-0000-4000-8000-000000000001',eventId:'15150000-0000-4000-8000-000000000002',path:'event/a.png',position:1,owned:null}]});vi.stubGlobal('fetch',fetcher)
 function Example(){const query=usePublicEventImages(['15150000-0000-4000-8000-000000000002']);return <p>{query.data?.[0]?.url??'loading'}</p>}
 render(<QueryClientProvider client={new QueryClient()}><Example /></QueryClientProvider>)
 expect(await screen.findByText(/functions\/v1\/event-images\?id=/)).toBeInTheDocument()
 expect(fetcher.mock.calls[0][1].headers.authorization).toBeUndefined()
})
