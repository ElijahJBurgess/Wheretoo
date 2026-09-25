import { Navigate } from 'react-router-dom'
// Preserve old bookmarks while keeping identity within the Profile step.
export function StorefrontIdentityPage() {
  return <Navigate replace to='/organizer/setup' />
}
