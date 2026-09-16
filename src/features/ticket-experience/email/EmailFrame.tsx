import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'
import { emailStyles } from './emailStyles'

type EmailFrameProps = {
  preview: string
  eyebrow: string
  title: string
  recipientLabel: string
  children: ReactNode
  viewTicketsUrl?: string
  privacyLabel?: string
  actionLabel?: string
  supportEmail?: string
}

export function EmailFrame({
  preview,
  eyebrow,
  title,
  recipientLabel,
  children,
  viewTicketsUrl,
  actionLabel = 'View Tickets',
  privacyLabel = 'This private link opens your ticket collection. Keep it to yourself.',
  supportEmail,
}: EmailFrameProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Text style={emailStyles.brand}>whereto</Text>
          <Section style={emailStyles.content}>
            <Text style={emailStyles.eyebrow}>{eyebrow}</Text>
            <Heading as="h1" style={emailStyles.heading}>{title}</Heading>
            <Text style={emailStyles.text}>Hi {recipientLabel},</Text>
            {children}
            {viewTicketsUrl ? (
              <>
                <Button href={viewTicketsUrl} style={emailStyles.button}>{actionLabel}</Button>
                <Text style={emailStyles.privacy}>{privacyLabel}</Text>
              </>
            ) : null}
            {supportEmail ? <Text style={emailStyles.privacy}>Need help? Reply to this email or contact {supportEmail}.</Text> : null}
            <Hr style={emailStyles.rule} />
          </Section>
          <Text style={emailStyles.footer}>Whereto · Find your next night out.</Text>
        </Container>
      </Body>
    </Html>
  )
}
