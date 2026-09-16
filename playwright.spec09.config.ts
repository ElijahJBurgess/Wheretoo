import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir:'./tests/e2e',testMatch:'spec09.spec.ts',fullyParallel:false,workers:1,timeout:90000,use:{baseURL:'http://127.0.0.1:3029',trace:'off',video:'off',screenshot:'off'},reporter:[['list']] })
