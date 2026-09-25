import { Link } from "react-router-dom";
import type { ImportRow } from "./eventImports.schemas";
const labels: Record<ImportRow["state"], string> = {
  pending: "Pending",
  geocoding: "Verifying address",
  ready: "Ready",
  needs_review: "Needs review",
  invalid: "Invalid",
  duplicate_possible: "Possible duplicate",
  skipped: "Skipped",
  imported: "Imported",
  failed: "Failed",
};
export function EventImportReviewTable({
  rows,
  selected,
  onSelect,
  onAction,
  pending,
  isOwner,
}: {
  rows: ImportRow[];
  selected: string[];
  onSelect: (id: string) => void;
  onAction: (
    row: ImportRow,
    action: "skip" | "retry" | "override_duplicate",
  ) => void;
  pending: boolean;
  isOwner: boolean;
}) {
  return (
    <div
      className="event-imports__table"
      tabIndex={0}
      role="region"
      aria-label="CSV row review"
    >
      <table>
        <thead>
          <tr>
            {[
              "Select",
              "Row",
              "Event",
              "Date",
              "Venue",
              "Address",
              "Category",
              "Capacity",
              "Status",
            ].map((x) => <th key={x} scope="col">{x}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select row ${r.record_number}`}
                  checked={selected.includes(r.id)}
                  disabled={pending || r.state !== "ready"}
                  onChange={() => onSelect(r.id)}
                />
              </td>
              <td>{r.record_number}</td>
              <td>
                <strong>{r.input.title}</strong>
                {r.resulting_event_id && (
                  <>
                    <br />
                    <Link
                      to={`/moderation/event-imports/drafts/${r.resulting_event_id}`}
                    >
                      View imported event
                    </Link>
                    {isOwner
                      ? (
                        <>
                          <br />
                          <Link
                            to={`/organizer/events/${r.resulting_event_id}/edit`}
                          >
                            Edit draft
                          </Link>
                        </>
                      )
                      : <p>Awaiting official organizer review</p>}
                  </>
                )}
              </td>
              <td>
                {r.input.start_date}
                <br />
                {r.input.start_time} Los Angeles
              </td>
              <td>{r.input.venue_name}</td>
              <td>{r.input.address}</td>
              <td>{r.input.category}</td>
              <td>{r.input.capacity ?? "Unlimited"}</td>
              <td>
                <strong>{labels[r.state]}</strong>
                {r.errors.map((e, i) => <p key={i}>{e.message}</p>)}
                {r.failure_code && <p>{r.failure_code.replaceAll("_", " ")}</p>}
                {r.state === "needs_review" && (
                  <p>Fix the address in your CSV and upload a new file.</p>
                )}
                {r.duplicate_count > 0 && (
                  <details>
                    <summary>{r.duplicate_count} possible duplicates</summary>
                    <ul>
                      {r.duplicate_candidates.map((c) => (
                        <li key={`${c.kind}-${c.id}`}>{c.title}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {r.state === "duplicate_possible" && (
                  <button
                    disabled={pending}
                    onClick={() => onAction(r, "override_duplicate")}
                  >
                    Import anyway
                  </button>
                )}
                {r.state === "failed" && (
                  <button
                    disabled={pending}
                    onClick={() => onAction(r, "retry")}
                  >
                    Retry
                  </button>
                )}
                {!["imported", "skipped"].includes(r.state) && (
                  <button
                    disabled={pending}
                    onClick={() => onAction(r, "skip")}
                  >
                    Skip
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
