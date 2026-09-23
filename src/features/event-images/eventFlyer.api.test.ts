import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ mutate: vi.fn(), validate: vi.fn() }))
vi.mock('./eventImages.api', () => ({ listEventImages: async () => [], uploadEventImage: async () => 'event/new.png', removeEventImage: vi.fn(), reorderEventImages: vi.fn() }))
vi.mock('./coverTransport', () => ({ mutateCover: mock.mutate }))
vi.mock('./imageFiles', () => ({ validateImageContent: mock.validate, validateImageSelection: vi.fn() }))
import { replaceEventFlyer, removeEventFlyer } from './eventFlyer.api'
const file = new File(['png'], 'cover.png', { type: 'image/png' })
beforeEach(() => vi.resetAllMocks())
it('sends the displayed revision with one atomic replacement, not a freshly fetched revision', async () => {
 const current = () => true
 await replaceEventFlyer('event', file, current, 7)
 expect(mock.mutate).toHaveBeenCalledWith('event', 7, { file }, current)
})
it('does not submit after identity changes during validation', async () => {
 let active = true
 mock.validate.mockImplementation(async () => { active = false })
 await expect(replaceEventFlyer('event', file, () => active, 7)).rejects.toThrow('session changed')
 expect(mock.mutate).not.toHaveBeenCalled()
})
it('propagates an uncertain upload without client-side deletion or reordering', async () => {
 mock.mutate.mockRejectedValue(new Error('Refresh flyer before trying again.'))
 await expect(replaceEventFlyer('event', file, () => true, 7)).rejects.toThrow('Refresh flyer')
 expect(mock.mutate).toHaveBeenCalledOnce()
})
it('removes the displayed revision in one guarded operation', async () => {
 const current = () => true
 await removeEventFlyer('event', current, 9)
 expect(mock.mutate).toHaveBeenCalledWith('event', 9, { remove: true }, current)
})
