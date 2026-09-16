import { z } from 'zod'

// PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
// Public readers must accept every canonical title/venue the database can publish.
export function publicTextSchema(min: number, max: number) {
  return z.string().trim().refine(value => {
    const length = Array.from(value).length
    return length >= min && length <= max
  }, { message: `Must contain between ${min} and ${max} characters.` })
}
