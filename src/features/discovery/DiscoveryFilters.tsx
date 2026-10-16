import { useLayoutEffect, useRef } from 'react'
import './discovery-filters.css'
import type { ReactNode } from 'react'
import { eventCategories } from '../events/event.types'
import type { DiscoveryFilters as Filters } from './discovery.types'
import { categoryLabel } from './discovery.presentation'
import { defaultDiscoveryFilters } from './discovery.filters'

export function DiscoveryFilters({ filters, onChange, children }: { filters: Filters; onChange(filters: Filters, field?: keyof Filters): void; children?: ReactNode }) {
  const latest = useRef(filters)
  const { when, category, price } = filters
  useLayoutEffect(() => { latest.current = { when, category, price } }, [when, category, price])
  function change(patch: Partial<Filters>) {
    const next = { ...latest.current, ...patch }
    latest.current = next
    const fields = Object.keys(patch) as (keyof Filters)[]
    if (fields.length === 1) onChange(next, fields[0])
    else onChange(next)
  }
  return <section aria-label="Filter events" className="discovery-filters">
    <div className="discovery-filter-region">SF Bay Area</div>
    <label>Date<select value={filters.when} onChange={e => change({ when: e.target.value as Filters['when'] })}>
      <option value="next7">Next 7 Days</option><option value="today">Today</option><option value="weekend">This Weekend</option>
      {filters.when === 'upcoming' ? <option value="upcoming">Next 30 Days</option> : null}
    </select></label>
    <label>Category<select value={filters.category ?? ''} onChange={e => change({ category: (e.target.value || null) as Filters['category'] })}>
      <option value="">Any category</option>{eventCategories.map(category => <option key={category} value={category}>{categoryLabel(category)}</option>)}
    </select></label>
    <label>Admission<select value={filters.price ?? ''} onChange={e => change({ price: (e.target.value || null) as Filters['price'] })}>
      <option value="">Any</option><option value="free">Free</option><option value="paid">Paid</option>
    </select></label>
    {children}
    {filters.when !== 'next7' || filters.category || filters.price ? <button className="discovery-clear-filters" type="button" onClick={() => change(defaultDiscoveryFilters)}>Clear filters</button> : null}
  </section>
}
