export const project: string
export const API_URL: string
export const APP_URL: string
export function docker(args: string[]): string
export function combinedMapEnvironment(): Promise<{ API_URL: string; ANON_KEY: string; SERVICE_KEY: string }>
