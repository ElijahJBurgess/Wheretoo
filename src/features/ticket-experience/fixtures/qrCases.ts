const payloadLengths = [32, 96, 192] as const
const payloadSeeds = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const

export type QrCaseId = `${typeof payloadLengths[number]}-${typeof payloadSeeds[number]}`

function credentialFor(length: typeof payloadLengths[number], seed: typeof payloadSeeds[number]): string {
  const prefix = `WH-TEST-ADMIT-QR-${length}-${seed}-`
  const alphabet = 'ABCDEFGHKLMNPQRSTUVWXYZ23456789'
  let value = (Math.imul(seed, 0x9e3779b9) ^ length) >>> 0
  let credential = prefix

  while (credential.length < length) {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    credential += alphabet[(value >>> 0) % alphabet.length]
  }

  return credential.slice(0, length)
}

export const qrCases = Object.freeze(Object.fromEntries(
  payloadLengths.flatMap((length) => payloadSeeds.map((seed) => [
    `${length}-${seed}` as QrCaseId,
    Object.freeze({ credential: credentialFor(length, seed) }),
  ])),
)) as Readonly<Record<QrCaseId, { credential: string }>>
