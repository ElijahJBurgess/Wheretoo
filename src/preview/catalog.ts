export type PreviewScreen = {
  label: string
  slug?: string
  route?: string
  status?: 'Preview not available' | 'Runtime data required'
  note?: string
}
export const previewSections: { title: string; screens: PreviewScreen[] }[] = [
  { title: 'Buyer Journey', screens: [
    { label: 'Ticket Selection', slug: 'ticket-selection', note: 'Approved redesign' },
    { label: 'Checkout', slug: 'checkout', note: 'Current frontend' },
    { label: 'Confirmation', slug: 'confirmation', note: 'Current frontend' },
    { label: 'Ticket Wallet', status: 'Preview not available' },
    { label: 'QR Ticket', status: 'Preview not available' },
    { label: 'Used / Already Scanned Ticket', status: 'Preview not available' },
    { label: 'Refunded Ticket', status: 'Preview not available' },
    { label: 'Cancelled Ticket', status: 'Preview not available' },
  ] },
  { title: 'Public / Customer Screens Already In Repo', screens: [
    { label: 'Public Event / Ticket Selection', slug: 'public-event', route: '/events/:eventId' },
    { label: 'Checkout', slug: 'checkout', route: '/events/:eventId/checkout' },
    { label: 'Order Confirmation', slug: 'confirmation', route: '/orders/:confirmationToken' },
    { label: 'Sign Up', slug: 'sign-up', route: '/auth/sign-up' },
    { label: 'Check Email', slug: 'check-email', route: '/auth/check-email' },
    { label: 'Sign In', slug: 'sign-in', route: '/auth/sign-in' },
    { label: 'Organizer Terms', slug: 'organizer-terms', route: '/organizer-terms' },
    { label: 'Event Policy', slug: 'event-policy', route: '/event-policy' },
  ] },
  { title: 'Organizer Screens Already In Repo', screens: [
    { label: 'Organizer Setup', slug: 'organizer-setup', route: '/organizer/setup' },
    { label: 'Organizer Events', slug: 'organizer-events', route: '/organizer/events' },
    { label: 'Organizer Payments', route: '/organizer/settings/payments', status: 'Runtime data required', note: 'Stripe’s embedded interface requires an account session.' },
    { label: 'Create Event', slug: 'create-event', route: '/organizer/events/new', note: 'Basics step' },
    { label: 'Edit Event', slug: 'edit-event', route: '/organizer/events/:eventId/edit', note: 'Basics step with saved fixture' },
    { label: 'Event Preview', slug: 'event-preview', route: '/organizer/events/:eventId/preview' },
    { label: 'Ticket Tier Management', slug: 'ticket-tiers', route: '/organizer/events/:eventId/tickets' },
    { label: 'Published Organizer Event', slug: 'published-event', route: '/organizer/events/:eventId' },
  ] },
  { title: 'Staff / Moderation Screens Already In Repo', screens: [
    { label: 'Moderation Queue', slug: 'moderation', route: '/moderation' },
    { label: 'Moderation Case', slug: 'moderation-case', route: '/moderation/events/:eventId' },
  ] },
]
