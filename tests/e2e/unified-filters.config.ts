import journey from './map-event-journey.config'
import { defineConfig } from '@playwright/test'
export default defineConfig({ ...journey, testMatch: 'unified-filters.spec.ts', outputDir: '../../test-results/unified-filters' })
