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
}

export function EmailFrame({
  preview,
  eyebrow,
  title,
  recipientLabel,
  children,
  viewTicketsUrl,
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
