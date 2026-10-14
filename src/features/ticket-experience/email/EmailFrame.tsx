import { brandAssets, emailLogoUrl } from '../../../components/brand/brandAssets'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'
import { emailStyles } from './emailStyles'

type EmailFrameProps = {
  brandAssetOrigin?: string
  preview: string
  eyebrow: string
  title: string
  recipientLabel: string
  children: ReactNode
  viewTicketsUrl?: string
}

export function EmailFrame({
  brandAssetOrigin,
  preview,
  eyebrow,
  title,
  recipientLabel,
  children,
  viewTicketsUrl,
}: EmailFrameProps) {
  const assetOrigin = brandAssetOrigin ?? viewTicketsUrl
  if (!assetOrigin) throw new Error('Email branding requires brandAssetOrigin or a ticket URL')
  const logo = brandAssets.wordmark.white
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.brand}>
            <Img alt="Wheretoo" src={emailLogoUrl(assetOrigin)} width={140} height={140 * logo.height / logo.width} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
          </Section>
          <Section style={emailStyles.content}>
            <Text style={emailStyles.eyebrow}>{eyebrow}</Text>
            <Heading as="h1" style={emailStyles.heading}>{title}</Heading>
            <Text style={emailStyles.text}>Hi {recipientLabel},</Text>
            {children}
            {viewTicketsUrl ? (
              <>
                <Button href={viewTicketsUrl} style={emailStyles.button}>View Tickets</Button>
                <Text style={emailStyles.privacy}>This private link opens your ticket collection. Keep it to yourself.</Text>
              </>
            ) : null}
            <Hr style={emailStyles.rule} />
          </Section>
          <Text style={emailStyles.footer}>Whereto · Find your next night out.</Text>
        </Container>
      </Body>
    </Html>
  )
}
