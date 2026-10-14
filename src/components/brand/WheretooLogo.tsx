import { brandAssets, type LogoTheme, type LogoVariant } from './brandAssets'
import './brand.css'

type WheretooLogoProps = {
  variant?: LogoVariant
  theme?: LogoTheme
  className?: string
  width?: number
  alt?: string
}

export function WheretooLogo({ variant = 'wordmark', theme = 'purple', className = '', width, alt = 'Wheretoo' }: WheretooLogoProps) {
  const asset = brandAssets[variant][theme]
  const displayWidth = width ?? (variant === 'wordmark' ? 140 : 40)
  return <img
    alt={alt}
    className={`wheretoo-logo ${className}`.trim()}
    src={asset.src}
    width={displayWidth}
    height={displayWidth * asset.height / asset.width}
    draggable={false}
  />
}
