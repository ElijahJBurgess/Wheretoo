type ShareDependencies = {
  share?: (data: ShareData) => Promise<void>
  copy?: (url: string) => Promise<void>
}
export async function shareStorefront(
  url: string,
  name: string,
  dependencies: ShareDependencies = {
    share: navigator.share?.bind(navigator),
    copy: navigator.clipboard?.writeText.bind(navigator.clipboard),
  },
): Promise<'shared' | 'copied' | 'cancelled' | 'manual'> {
  if (dependencies.share) {
    try {
      await dependencies.share({ title: `${name} · Wheretoo`, url })
      return 'shared'
    } catch (error) {
      if (
        error instanceof DOMException && error.name === 'AbortError'
      ) return 'cancelled'
    }
  }
  if (dependencies.copy) {
    try {
      await dependencies.copy(url)
      return 'copied'
    } catch { /* Expose a selectable URL when permission is denied. */ }
  }
  return 'manual'
}
