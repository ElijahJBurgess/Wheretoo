import { expect, it, vi } from 'vitest'
import { downloadExport } from './export.csv'
it('initiates one named download and retires its temporary anchor and object URL', () => {
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:synthetic-export'), revoke = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('event-orders.csv'); expect(this.isConnected).toBe(true) })
  try {
    downloadExport('\uFEFF"header"\r\n', 'event-orders.csv')
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).toBeNull(); expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:synthetic-export')
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
