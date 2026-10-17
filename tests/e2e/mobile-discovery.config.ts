import { defineConfig } from '@playwright/test'
import journey from './map-event-journey.config'
const sizes = [[320, 568], [375, 667], [390, 844], [430, 932]]
export default defineConfig({
  ...journey,
  outputDir: '../../test-results/mobile-discovery',
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    ...sizes.flatMap(([width, height]) => [
      { name: `mobile-${width}`, use: { viewport: { width, height }, isMobile: true, hasTouch: true } },
      { name: `landscape-${width}`, use: { viewport: { width: height, height: width }, isMobile: true, hasTouch: true } },
    ]),
  ],
})
