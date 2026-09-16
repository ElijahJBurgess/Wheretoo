import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), remove: vi.fn(), reorder: vi.fn(), validate: vi.fn() }))
vi.mock('./eventImages.api', () => ({ listEventImages: mock.list, uploadEventImage: mock.upload, removeEventImage: mock.remove, reorderEventImages: mock.reorder }))
vi.mock('./imageFiles', () => ({ validateImageContent: mock.validate, validateImageSelection: vi.fn() }))
import { replaceEventFlyer, removeEventFlyer } from './eventFlyer.api'
const rows = [1, 2, 3].map(n => ({ id: `image-${n}`, eventId: 'event', path: `event/${n}.png`, position: n, owned: true, url: 'url' }))
const replacement = { ...rows[0], id: 'new', path: 'event/new.png', position: 2 }
const file = new File(['png'], 'flyer.png', { type: 'image/png' })
beforeEach(() => {
 vi.resetAllMocks()
 mock.upload.mockResolvedValue(replacement.path)
 mock.list.mockResolvedValueOnce([rows[0]]).mockResolvedValueOnce([rows[0], replacement])
})
it('uploads before switching the canonical flyer and only then removes the old flyer', async () => {
 await replaceEventFlyer('event', file)
 expect(mock.reorder).toHaveBeenCalledWith('event', ['new', 'image-1'])
 expect(mock.remove).toHaveBeenCalledWith(rows[0].path)
 expect(mock.upload.mock.invocationCallOrder[0]).toBeLessThan(mock.reorder.mock.invocationCallOrder[0])
 expect(mock.reorder.mock.invocationCallOrder[0]).toBeLessThan(mock.remove.mock.invocationCallOrder[0])
})
it('retains the canonical flyer when upload fails', async () => {
 mock.upload.mockRejectedValue(new Error('offline'))
 await expect(replaceEventFlyer('event', file)).rejects.toThrow('offline')
 expect(mock.remove).not.toHaveBeenCalled(); expect(mock.reorder).not.toHaveBeenCalled()
})
it('makes room in a legacy full gallery without removing its canonical flyer first', async () => {
 mock.list.mockReset().mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[0], rows[1], replacement])
 await replaceEventFlyer('event', file)
 expect(mock.remove.mock.calls.map(c => c[0])).toEqual([rows[2].path, rows[0].path, rows[1].path])
 expect(mock.remove.mock.invocationCallOrder[1]).toBeGreaterThan(mock.reorder.mock.invocationCallOrder[0])
})
it('does not remove existing artwork when the canonical switch conflicts', async () => {
 mock.reorder.mockRejectedValue(new Error('changed'))
 await expect(replaceEventFlyer('event', file)).rejects.toThrow('changed')
 expect(mock.remove).not.toHaveBeenCalled()
})
it('stops after an identity change without reordering or deleting', async () => {
 let current = true
 mock.upload.mockImplementation(async () => { current = false; return replacement.path })
 await expect(replaceEventFlyer('event', file, () => current)).rejects.toThrow('session changed')
 expect(mock.remove).not.toHaveBeenCalled(); expect(mock.reorder).not.toHaveBeenCalled()
})
it('removes legacy secondary images before the flyer so none becomes the new flyer', async () => {
 mock.list.mockReset().mockResolvedValue(rows)
 await removeEventFlyer('event')
 expect(mock.remove.mock.calls.map(c => c[0])).toEqual([rows[2].path, rows[1].path, rows[0].path])
})

it('fails closed when another tab uploads during replacement without deleting either candidate', async () => {
 const other = { ...replacement, id: 'other', path: 'event/other.png', position: 3 }
 mock.list.mockReset().mockResolvedValueOnce([rows[0]]).mockResolvedValueOnce([rows[0], replacement, other])
 await expect(replaceEventFlyer('event', file)).rejects.toThrow('changed')
 expect(mock.reorder).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled()
})
