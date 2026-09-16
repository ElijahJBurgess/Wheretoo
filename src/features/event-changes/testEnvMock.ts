import { vi } from 'vitest'
vi.mock('../../lib/env', () => ({ publicEnv: { supabaseUrl: 'https://unit.invalid', supabasePublishableKey: 'public-test' } }))
