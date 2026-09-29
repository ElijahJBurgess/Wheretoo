import { useController, type Control } from 'react-hook-form'
import { Field } from '../../components/ui/Field'
import type { EventFormValues } from './event.types'

export function EventDateTimeField({ control, name, label }: { control: Control<EventFormValues>; name: 'startsAt' | 'endsAt'; label: string }) {
  const { field: { value, onChange, onBlur, ref: inputRef }, fieldState } = useController({ control, name })
  const [date = '', time = ''] = value.split('T')
  function change(nextDate: string, nextTime: string) {
    // Keep incomplete halves in the form so validation and back navigation
    // cannot silently turn an unfinished time into an empty canonical value.
    onChange(nextDate || nextTime ? `${nextDate}T${nextTime}` : '')
  }
  return <fieldset className="event-date-time">
    <legend>{label}</legend>
    <div className="event-date-time__inputs">
      <Field label={`${label} date`} name={name} error={fieldState.error?.message}>
        <input ref={inputRef} type="date" value={date} onBlur={onBlur} onChange={e => change(e.target.value, time)} />
      </Field>
      <Field label={`${label} time`} name={`${name}-time`}>
        <input type="time" value={time} onBlur={onBlur} onChange={e => change(date, e.target.value)} aria-invalid={fieldState.invalid || undefined} aria-describedby={fieldState.error ? `${name}-error` : undefined} />
      </Field>
    </div>
  </fieldset>
}
