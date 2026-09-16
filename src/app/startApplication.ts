import { renderStartupFailure } from './startupFailure'

type ApplicationLoader<T> = () => Promise<T>
type ApplicationRenderer<T> = (application: T) => void | Promise<void>

export async function startApplication<T>(
  root: HTMLElement,
  loadApplication: ApplicationLoader<T>,
  renderApplication: ApplicationRenderer<T>,
) {
  try {
    const application = await loadApplication()
    await renderApplication(application)
  } catch {
    renderStartupFailure(root)
  }
}
