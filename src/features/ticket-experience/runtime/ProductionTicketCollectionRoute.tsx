import { createTicketCollectionReader } from '../adapters/ticketCollectionReader'
import type { WalletProvider } from '../contracts/wallet'
import { TicketCollectionPage } from '../customer/TicketCollectionPage'

const reader = createTicketCollectionReader()
const walletProvider: WalletProvider = {
  getCapability: () => ({ kind: 'unavailable', label: 'Add to Wallet — Coming later' }),
}

export default function ProductionTicketCollectionRoute() {
  return <TicketCollectionPage reader={reader} walletProvider={walletProvider} />
}
