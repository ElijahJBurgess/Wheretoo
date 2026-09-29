import { fireEvent, render, screen } from '@testing-library/react'
import { useForm, useWatch } from 'react-hook-form'
import { expect, it } from 'vitest'
import { EventDateTimeField } from './EventDateTimeField'
import type { EventFormValues } from './event.types'

function Harness({ initial = '2027-12-01T18:30' }: { initial?: string }) {
  const { control, reset } = useForm<EventFormValues>({ defaultValues: { startsAt: initial } })
  const value = useWatch({ control, name: 'startsAt' })
  return <><EventDateTimeField control={control} name="startsAt" label="Start" /><output>{value}</output><button onClick={() => reset({ startsAt: '2027-12-02T19:00' })}>Reload</button></>
}
it('splits and recomposes wall time without dropping a partially cleared date or time', () => {
  render(<Harness />)
  expect(screen.getByLabelText('Start date')).toHaveValue('2027-12-01')
  expect(screen.getByLabelText('Start time')).toHaveValue('18:30')
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } })
  expect(screen.getByRole('status')).toHaveTextContent('T18:30')
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-12-03' } })
  expect(screen.getByRole('status')).toHaveTextContent('2027-12-03T18:30')
  fireEvent.click(screen.getByText('Reload'))
  expect(screen.getByLabelText('Start time')).toHaveValue('19:00')
})

it('retains the date when entering a time into an initially empty schedule', () => {
  render(<Harness initial="" />)
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-12-03' } })
  fireEvent.blur(screen.getByLabelText('Start date'))
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '17:00' } })
  expect(screen.getByLabelText('Start date')).toHaveValue('2027-12-03')
  expect(screen.getByRole('status')).toHaveTextContent('2027-12-03T17:00')
})
