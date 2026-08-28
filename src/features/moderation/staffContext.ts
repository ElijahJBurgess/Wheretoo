import { useOutletContext } from 'react-router-dom'
import type { StaffRole } from './moderation.types'

type StaffContext = {
  role: StaffRole
  staffUserId: string
}

export function useStaffContext(): StaffContext {
  return useOutletContext<StaffContext>()
}
