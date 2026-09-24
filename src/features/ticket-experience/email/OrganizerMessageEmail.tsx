import { Body, Button, Container, Head, Heading, Hr, Html, Img, Preview, Section, Text } from '@react-email/components'
import type { OrganizerMessageProps } from './email.types'
import { emailStyles } from './emailStyles'

/** Frozen organizer-message-v1. Material changes require a new fingerprinted version. */
export function OrganizerMessageEmail(props: OrganizerMessageProps) {
  return <Html lang="en"><Head /><Preview>{props.subject}</Preview><Body style={emailStyles.body}>
    <Container style={emailStyles.container}>
      <Text style={emailStyles.brand}>Wheretoo</Text>
      <Section style={emailStyles.content}>
        {props.organizerLogoUrl ? <Img src={props.organizerLogoUrl} alt="" width="56" height="56" /> : null}
        <Text style={emailStyles.eyebrow}>{props.organizerName} via Wheretoo</Text>
        <Heading as="h1" style={emailStyles.heading}>{props.subject}</Heading>
        <Section style={emailStyles.facts}>
          <Text style={emailStyles.fact}><strong>{props.eventName}</strong><br />{props.startsAtLabel}<br />{props.venueName}</Text>
        </Section>
        {props.flyerUrl ? <Img src={props.flyerUrl} alt={`${props.eventName} flyer`} width="500" style={{ width: '100%', height: 'auto', marginBottom: '20px' }} /> : null}
        <Text style={{ ...emailStyles.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{props.body.split('\n').map((line, index) => <span key={index}>{index > 0 ? <br /> : null}{line}</span>)}</Text>
        {props.eventUrl ? <Button href={props.eventUrl} style={emailStyles.button}>View Event</Button> : null}
        <Text style={emailStyles.privacy}>Replies go to Wheretoo support: {props.supportEmail}.</Text>
        <Text style={emailStyles.privacy}>You received this message because this email was associated with an active ticket purchase or RSVP when the organizer queued it.</Text>
        <Hr style={emailStyles.rule} />
      </Section>
      <Text style={emailStyles.footer}>Wheretoo · Find your next night out.</Text>
    </Container>
  </Body></Html>
}
