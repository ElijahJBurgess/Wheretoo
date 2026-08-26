import process from 'node:process'
import { configDefaults, defineConfig } from 'vitest/config'

const stripeTransactionProofEnabled = process.env.RUN_STRIPE_TRANSACTION_PROOF === '1'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: stripeTransactionProofEnabled
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'tests/integration/stripe-ticketing.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: false,
  },
})
