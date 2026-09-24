import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailStyles } from "../../../../src/features/ticket-experience/email/emailStyles.ts";
export type WaitlistEmailProps = {
  purpose: "confirmation" | "restock";
  subject: string;
  eventName: string;
  tierName: string;
  date: string;
  venue: string;
  price: string;
  eventUrl: string;
  leaveUrl: string;
};
export function WaitlistEmail(p: WaitlistEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{p.subject}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Text style={emailStyles.brand}>Wheretoo</Text>
          <Section style={emailStyles.content}>
            <Heading style={emailStyles.heading}>
              {p.purpose === "confirmation"
                ? "You’re on the waitlist"
                : "Tickets are available again"}
            </Heading>
            <Text style={emailStyles.fact}>
              <strong>{p.eventName}</strong>
              <br />
              {p.tierName}
              <br />
              {p.date}
              <br />
              {p.venue}
            </Text>
            {p.purpose === "restock"
              ? (
                <>
                  <Text style={emailStyles.text}>{p.price}</Text>
                  <Text style={emailStyles.text}>
                    Tickets are available again, but they may sell out before
                    you complete checkout. Availability is not guaranteed.
                  </Text>
                  <Button style={emailStyles.button} href={p.eventUrl}>
                    Buy Tickets
                  </Button>
                </>
              )
              : (
                <Text style={emailStyles.text}>
                  We’ll email you if tickets become available. Joining the
                  waitlist does not reserve tickets.
                </Text>
              )}
            <Text style={emailStyles.text}>
              Tickets are first come, first served through normal checkout.
            </Text>
            <Button href={p.leaveUrl}>Leave Waitlist</Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
