export type WalletCapability = {
  kind: 'unavailable'
  label: 'Add to Wallet — Coming later'
}

export interface WalletProvider {
  getCapability(): WalletCapability
}
