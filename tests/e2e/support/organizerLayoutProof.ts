import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OrganizerLayout } from '../../../src/components/layout/OrganizerLayout'

// Browser-only layout specimen; no session, database, or product route is added.
export function renderOrganizerLayoutProof() {
  const target = document.createElement('div')
  document.body.replaceChildren(target)
  createRoot(target).render(createElement(OrganizerLayout, { staffRole: 'admin' }, 'Layout containment specimen'))
}
