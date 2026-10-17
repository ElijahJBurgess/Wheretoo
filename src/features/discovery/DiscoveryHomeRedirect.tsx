import { discoveryMode, discoverySearch } from './discovery.location'
import { Navigate, useLocation } from 'react-router-dom'
import { parseDiscoverySearch } from './discovery.filters'

export function DiscoveryHomeRedirect() {
  const location = useLocation()
  return <Navigate replace to={'/discover' + discoverySearch(parseDiscoverySearch(location.search), discoveryMode(location.search))} />
}
