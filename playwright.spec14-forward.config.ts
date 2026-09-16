import { defineConfig } from '@playwright/test'
import base from './playwright.spec14.config'
export default defineConfig({ ...base, testMatch: 'spec14-unattached-forward.spec.ts' })
