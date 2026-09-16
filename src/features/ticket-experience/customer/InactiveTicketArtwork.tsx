/** Decorative ticket pattern only: no QR encoding, finder squares, or admission input. */
export function InactiveTicketArtwork() {
  return <div className="buyer-inactive-artwork" data-inactive-ticket aria-hidden="true">
    <svg viewBox="0 0 160 160" fill="none">
      <rect x="12" y="12" width="136" height="136" rx="12" stroke="currentColor" strokeWidth="2" />
      <path d="M25 42h32m14 0h35m12 0h17M25 58h18m14 0h28m12 0h38M25 74h30m16 0h18m18 0h28M25 90h19m13 0h38m14 0h26M25 106h34m15 0h26m14 0h21M25 122h18m14 0h28m14 0h36" stroke="currentColor" strokeWidth="9" />
    </svg>
    <span className="buyer-inactive-artwork__slash" />
  </div>
}
