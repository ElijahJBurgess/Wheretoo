import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useStaffContext } from "../moderation/staffContext";
import { readImportDraft } from "./eventImports.api";
import "./eventImports.css";
export function EventImportDraftPage() {
  const { eventId = "" } = useParams(), { staffUserId } = useStaffContext();
  const q = useQuery({
    queryKey: ["event-imports", staffUserId, "draft", eventId],
    queryFn: () => readImportDraft(eventId),
  });
  if (q.isPending) return <p role="status">Loading event…</p>;
  if (q.isError) {
    return (
      <section>
        <h1>Event unavailable</h1>
        <button onClick={() => void q.refetch()}>Retry</button>
      </section>
    );
  }
  const { event, isOwner, changedSinceImport } = q.data;
  return (
    <section className="event-imports">
      <Link to="/moderation/event-imports">All imports</Link>
      <h1>{event.title}</h1>
      <p>{event.status} · {event.moderation_status.replaceAll("_", " ")}</p>
      <p>{event.description}</p>
      <p>{event.venue_name} · {event.address_line1}</p>
      {changedSinceImport && (
        <p>
          The event has changed since import. This is its current saved state.
        </p>
      )}
      {isOwner
        ? (
          <p>
            <Link to={`/organizer/events/${event.id}/edit`}>Edit draft</Link> ·
            {" "}
            <Link to={`/organizer/events/${event.id}/preview`}>
              Preview and publish
            </Link>
          </p>
        )
        : <p>Awaiting official organizer review</p>}
    </section>
  );
}
