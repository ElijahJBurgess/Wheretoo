export type TicketingProjectName = 'mobile-chromium' | 'desktop-chromium'
export type TicketingScenario = 'purchase' | 'visual'

export const task18CheckoutTierNames = ['General admission', 'VIP'] as const

const task18EventTitles: Record<TicketingProjectName, Record<TicketingScenario, string>> = {
  'mobile-chromium': {
    purchase: 'Sunset Sessions at the Ferry Building',
    visual: 'Friday Night at the Ferry Building',
  },
  'desktop-chromium': {
    purchase: 'Night Market Live at the Ferry Building',
    visual: 'Golden Gate Rooftop Sessions',
  },
}

export function task18EventTitle(
  projectName: TicketingProjectName,
  scenario: TicketingScenario,
): string {
  return task18EventTitles[projectName][scenario]
}

export function task18MapboxFeatureId(
  fixturePrefix: string,
  projectName: TicketingProjectName,
  scenario: TicketingScenario,
): string {
  return `task18.${fixturePrefix}.${projectName}.${scenario}`
}
