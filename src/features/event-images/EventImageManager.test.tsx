import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ images: vi.fn(), upload: vi.fn(), remove: vi.fn(), reorder: vi.fn(), refetch: vi.fn() }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' }, identityVersion: 1 }) }))
vi.mock('./eventImages.queries', () => ({ useEventImages: mock.images }))
vi.mock('./eventImages.api', () => ({ uploadEventImage: mock.upload, removeEventImage: mock.remove, reorderEventImages: mock.reorder }))
import { EventImageManager } from './EventImageManager'
const rows = [1,2,3].map(n => ({ id: `image-${n}`, eventId: 'event', path: `event/${n}.png`, position: n, url: `https://example.invalid/${n}.png`, owned: true }))
function show(count=0, state={}) {
 mock.images.mockReturnValue({ data: rows.slice(0,count), isPending: false, isError: false, refetch: mock.refetch, ...state })
 return render(<QueryClientProvider client={new QueryClient()}><EventImageManager eventId="event" /></QueryClientProvider>)
}
beforeEach(() => { vi.resetAllMocks(); mock.upload.mockResolvedValue(undefined); mock.remove.mockResolvedValue(undefined); mock.reorder.mockResolvedValue(undefined) })
it('uploads selected files and presents primary order from persisted records', async () => {
 const user=userEvent.setup(); show(1)
 expect(screen.getByText('Primary image')).toBeInTheDocument()
 await user.upload(screen.getByLabelText('Upload images'),new File(['image'],'two.png',{type:'image/png'}))
 await waitFor(()=>expect(mock.upload).toHaveBeenCalledOnce())
 expect(mock.upload.mock.calls[0][0]).toBe('event')
 await waitFor(()=>expect(screen.queryByText('Saving images…')).not.toBeInTheDocument())
})
it('disables a fourth image and sends a full persisted ordering', async () => {
 const user=userEvent.setup();show(3)
 expect(screen.getByLabelText('Upload images')).toBeDisabled()
 await user.click(screen.getByRole('button',{name:'Move image 3 earlier'}))
 expect(mock.reorder).toHaveBeenCalledWith('event',['image-1','image-3','image-2'])
})
it('rejects unsupported selections and excessive batch sizes before any upload', async () => {
 const user=userEvent.setup({applyAccept:false});show(2)
 await user.upload(screen.getByLabelText('Upload images'),new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Choose JPEG, PNG or WebP images.')
 await waitFor(()=>expect(screen.getByLabelText('Upload images')).toBeEnabled())
 await user.upload(screen.getByLabelText('Upload images'),[new File(['a'],'a.png',{type:'image/png'}),new File(['b'],'b.png',{type:'image/png'})])
 expect(await screen.findByRole('alert')).toHaveTextContent('at most three images')
 expect(mock.upload).not.toHaveBeenCalled()
})
it('removes only the selected stored object and reports uncertain failure', async () => {
 const user=userEvent.setup();show(2);mock.remove.mockRejectedValue(new Error('Removal could not be confirmed.'))
 await user.click(screen.getByRole('button',{name:'Remove image 2'}))
 expect(mock.remove).toHaveBeenCalledWith('event/2.png')
 expect(await screen.findByRole('alert')).toHaveTextContent('Removal could not be confirmed')
})
it('blocks mutation while loading and exposes read failure retry', async () => {
 const view=show(0,{isPending:true}); expect(screen.getByLabelText('Upload images')).toBeDisabled();view.unmount()
 show(0,{isError:true});expect(screen.getByLabelText('Upload images')).toBeDisabled()
 await userEvent.setup().click(screen.getByRole('button',{name:'Refresh images'}));expect(mock.refetch).toHaveBeenCalledOnce()
})

it('creates the draft before uploading and shows the selected preview while saving', async () => {
 let resolveDraft!: (id: string) => void
 const ensureEventId = vi.fn(() => new Promise<string>(resolve => { resolveDraft = resolve }))
 const settled = vi.fn()
 mock.images.mockReturnValue({ data: undefined, isPending: true, isError: false })
 render(<QueryClientProvider client={new QueryClient()}><EventImageManager eventId="" ensureEventId={ensureEventId} onUploadSettled={settled} /></QueryClientProvider>)
 await userEvent.setup().upload(screen.getByLabelText('Upload images'),new File(['image'],'first.png',{type:'image/png'}))
 await waitFor(()=>expect(ensureEventId).toHaveBeenCalledOnce())
 expect(await screen.findByAltText('Uploading image 1')).toBeInTheDocument()
 expect(mock.upload).not.toHaveBeenCalled()
 resolveDraft('saved-draft')
 await waitFor(()=>expect(mock.upload).toHaveBeenCalledWith('saved-draft',expect.any(File),expect.any(Function)))
 await waitFor(()=>expect(settled).toHaveBeenCalledWith('saved-draft',null))
})
it('does not create a draft for unsupported files or upload after draft creation fails', async () => {
 const ensureEventId=vi.fn().mockRejectedValue(new Error('Draft could not be saved.'))
 mock.images.mockReturnValue({ data:undefined,isPending:true,isError:false })
 render(<QueryClientProvider client={new QueryClient()}><EventImageManager eventId="" ensureEventId={ensureEventId} /></QueryClientProvider>)
 const user=userEvent.setup({applyAccept:false})
 await user.upload(screen.getByLabelText('Upload images'),new File(['svg'],'bad.svg',{type:'image/svg+xml'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Choose JPEG')
 expect(ensureEventId).not.toHaveBeenCalled()
 await waitFor(()=>expect(screen.getByLabelText('Upload images')).toBeEnabled())
 await user.upload(screen.getByLabelText('Upload images'),new File(['image'],'first.png',{type:'image/png'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Draft could not be saved')
 expect(mock.upload).not.toHaveBeenCalled()
})

it('accepts a dropped image through the same validated upload path', async () => {
 const view=show()
 fireEvent.drop(view.container.querySelector('.event-image-dropzone')!, { dataTransfer: { files: [new File(['png'],'drop.png',{type:'image/png'})] } })
 await waitFor(()=>expect(mock.upload).toHaveBeenCalledWith('event',expect.any(File),expect.any(Function)))
})
