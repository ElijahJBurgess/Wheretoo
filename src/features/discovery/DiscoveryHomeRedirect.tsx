import { Navigate, useLocation } from 'react-router-dom'
import { parseDiscoverySearch, serializeDiscoveryFilters } from './discovery.filters'

export function DiscoveryHomeRedirect() {
  const location = useLocation()
  return <Navigate replace to={'/discover' + serializeDiscoveryFilters(parseDiscoverySearch(location.search))} />
}
