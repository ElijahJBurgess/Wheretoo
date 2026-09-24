import { useQuery } from '@tanstack/react-query'
import { getWaitlistCapability } from './waitlist.api'
export function useWaitlistCapability(eventId:string){
 return useQuery({queryKey:['waitlist-capability',eventId],queryFn:()=>getWaitlistCapability(eventId),retry:false,staleTime:0,refetchInterval:15000,refetchIntervalInBackground:false})
}
