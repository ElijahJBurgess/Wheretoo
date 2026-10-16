import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DiscoveryFilters } from './DiscoveryFilters'
it('labels legacy30, composes filters and resets every dimension to next7', () => {
  const change = vi.fn()
  render(<DiscoveryFilters filters={{ when: 'upcoming', category: 'music', price: 'paid' }} onChange={change} />)
  expect(screen.getByRole('combobox', { name: 'Date' })).toHaveDisplayValue('Next 30 Days')
  fireEvent.change(screen.getByRole('combobox', { name: 'Admission' }), { target: { value: 'free' } })
  expect(change).toHaveBeenLastCalledWith({ when: 'upcoming', category: 'music', price: 'free' }, 'price')
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(change).toHaveBeenLastCalledWith({ when: 'next7', category: null, price: null })
})
it('composes consecutive native changes before the router commits new props', () => {
  const change = vi.fn()
  render(<DiscoveryFilters filters={{ when: 'next7', category: null, price: null }} onChange={change} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'music' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Admission' }), { target: { value: 'free' } })
  expect(change).toHaveBeenLastCalledWith({ when: 'next7', category: 'music', price: 'free' }, 'price')
})
