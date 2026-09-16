import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir:'./tests/e2e',testMatch:'spec10.spec.ts',fullyParallel:false,workers:1,timeout:120000,use:{baseURL:'http://127.0.0.1:3030',trace:'off',video:'off',screenshot:'off',launchOptions:{args:['--no-proxy-server']}},reporter:[['list']] })
