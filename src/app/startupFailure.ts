export const startupFailureCopy = {
  action: 'Go to sign in',
  description: 'Whereto could not start. You can return to sign in safely.',
  title: 'Application unavailable',
} as const

export function renderStartupFailure(root: HTMLElement) {
  const main = document.createElement('main')
  const heading = document.createElement('h1')
  const description = document.createElement('p')
  const action = document.createElement('a')

  heading.textContent = startupFailureCopy.title
  description.textContent = startupFailureCopy.description
  action.textContent = startupFailureCopy.action
  action.href = '/auth/sign-in'
  main.append(heading, description, action)
  root.replaceChildren(main)
}
