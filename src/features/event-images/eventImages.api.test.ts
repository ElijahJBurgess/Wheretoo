import { beforeEach, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({rpc:vi.fn(),sign:vi.fn()}))
vi.mock('../../lib/supabase/client',()=>({supabase:{rpc:mock.rpc,storage:{from:()=>({createSignedUrls:mock.sign})}}}))
import { listEventImages } from './eventImages.api'
const row={id:'15150000-0000-4000-8000-000000000001',eventId:'15150000-0000-4000-8000-000000000002',path:'event/image.png',position:1,owned:false}
beforeEach(()=>vi.resetAllMocks())
it('public reads use visibility-checked delivery, never signed storage URLs',async()=>{
 mock.rpc.mockResolvedValue({data:[row],error:null});const images=await listEventImages([row.eventId])
 expect(images[0].url).toContain('/functions/v1/event-images?id='+row.id);expect(mock.sign).not.toHaveBeenCalled()
})
it('owner reads use short signed URLs for draft preview',async()=>{
 mock.rpc.mockResolvedValue({data:[{...row,owned:true}],error:null});mock.sign.mockResolvedValue({data:[{signedUrl:'https://example.invalid/signed'}],error:null})
 expect((await listEventImages([row.eventId]))[0].url).toBe('https://example.invalid/signed');expect(mock.sign).toHaveBeenCalledWith([row.path],60)
})
it('empty records stay empty and failures do not become placeholders',async()=>{
 mock.rpc.mockResolvedValueOnce({data:[],error:null});expect(await listEventImages([row.eventId])).toEqual([])
 mock.rpc.mockResolvedValueOnce({data:null,error:new Error('offline')});await expect(listEventImages([row.eventId])).rejects.toThrow('offline')
})
