import { describe, expect, it } from 'vitest'
import { signInSchema, signUpSchema } from './auth.schemas'

describe('auth schemas', () => {
  it('rejects invalid organizer signup fields', () => {
    expect(signUpSchema.safeParse({ fullName: 'A', email: 'not-email', password: '1234567' }).success).toBe(false)
  })

  it('accepts a valid organizer signup', () => {
    expect(
      signUpSchema.safeParse({
        fullName: '  Avery Stone  ',
        email: ' organizer@example.com ',
        password: 'safe-password',
      }).success,
    ).toBe(true)
  })

  it('requires a valid email and nonempty password to sign in', () => {
    expect(signInSchema.safeParse({ email: 'bad', password: '' }).success).toBe(false)
    expect(signInSchema.safeParse({ email: ' organizer@example.com ', password: 'x' }).success).toBe(true)
  })
})
