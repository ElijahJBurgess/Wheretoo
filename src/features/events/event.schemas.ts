import { z } from 'zod'
import { eventCategories } from './event.types'

const optionalIsoDateTime = z.union([
  z.literal(''),
  z.iso.datetime({ offset: true, message: 'Use a valid date and time.' }),
])

const normalizedLocationSchema = z.object({
  mapboxFeatureId: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string(),
  city: z.string(),
  region: z.literal('CA'),
  postalCode: z.string(),
  countryCode: z.literal('US'),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
})

export const eventDraftSchema = z.object({
  title: z
    .string()
    .refine((value) => value.trim().length <= 120, 'Title must be 120 characters or fewer.'),
  description: z.string().max(5000, 'Description must be 5,000 characters or fewer.'),
  category: z.union([z.literal(''), z.enum(eventCategories)]),
  startsAt: optionalIsoDateTime,
  endsAt: optionalIsoDateTime,
  timezone: z.literal('America/Los_Angeles'),
  venueName: z
    .string()
    .refine((value) => value.trim().length <= 160, 'Venue name must be 160 characters or fewer.'),
  location: normalizedLocationSchema.nullable(),
  admissionType: z.enum(['free', 'paid']),
  capacity: z.number().int().positive().max(2_147_483_647).nullable(),
})

export const eventPublishSchema = eventDraftSchema.superRefine((values, context) => {
  const titleLength = values.title.trim().length
  if (titleLength < 3 || titleLength > 120) {
    context.addIssue({
      code: 'custom',
      path: ['title'],
      message: 'Title must be between 3 and 120 characters.',
    })
  }

  const descriptionLength = values.description.trim().length
  if (descriptionLength < 20 || descriptionLength > 5000) {
    context.addIssue({
      code: 'custom',
      path: ['description'],
      message: 'Description must be between 20 and 5,000 characters.',
    })
  }

  if (values.category === '') {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Choose a category.' })
  }

  const location = values.location
  if (
    location === null ||
    location.mapboxFeatureId.trim() === '' ||
    location.addressLine1.trim() === '' ||
    location.city.trim() === '' ||
    location.postalCode.trim() === ''
  ) {
    context.addIssue({
      code: 'custom',
      path: ['location'],
      message: 'Choose a verified California address.',
    })
  } else if (
    location.latitude < 36.8 ||
    location.latitude > 38.9 ||
    location.longitude < -123.6 ||
    location.longitude > -121
  ) {
    context.addIssue({
      code: 'custom',
      path: ['location'],
      message: 'Choose a location inside the current Bay Area service area.',
    })
  }

  const startsAt = Date.parse(values.startsAt)
  const endsAt = Date.parse(values.endsAt)
  if (!Number.isFinite(startsAt) || startsAt <= Date.now()) {
    context.addIssue({
      code: 'custom',
      path: ['startsAt'],
      message: 'Choose a future start time.',
    })
  }
  if (!Number.isFinite(endsAt) || !Number.isFinite(startsAt) || endsAt <= startsAt) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Choose an end time after the start time.',
    })
  }

  if (values.admissionType !== 'free') {
    context.addIssue({
      code: 'custom',
      path: ['admissionType'],
      message: 'Paid event publishing is not available in this milestone. Choose Free to publish.',
    })
  }
})
