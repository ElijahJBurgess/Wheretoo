import type { PropsWithChildren } from 'react'

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <div className="auth-layout">
      <header className="auth-layout__header">
        <span className="product-mark">whereto</span>
      </header>
      <main className="auth-layout__main">{children}</main>
    </div>
  )
}
