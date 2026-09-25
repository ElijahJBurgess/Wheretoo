import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffContext } from "../moderation/staffContext";
import { captureIdentityLifetime } from "../auth/identityLifetime";
import { useImport } from "./eventImports.queries";
import { actOnImport } from "./eventImports.api";
import { EventImportReviewTable } from "./EventImportReviewTable";
import type { ImportAction, ImportRow } from "./eventImports.schemas";
import "./eventImports.css";
export function EventImportBatchPage() {
  const { batchId = "" } = useParams(),
    { staffUserId } = useStaffContext(),
    client = useQueryClient();
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const q = useImport(staffUserId, batchId, offset);
  async function run(action: ImportAction) {
    if (pending) return;
    const current = captureIdentityLifetime(client, staffUserId);
    setPending(true);
    setError("");
    setMessage("");
    try {
      const r = await actOnImport(action, current);
      if (current()) {
        setSelected([]);
        setMessage(
          r.reviewChanged
            ? "Duplicate candidates changed. Review the updated warning, then choose again."
            : r.providerState === "paused"
            ? "Address processing is paused. Check provider configuration or budget."
            : "Progress saved. Continue to process remaining rows.",
        );
        await client.invalidateQueries({
          queryKey: ["event-imports", staffUserId],
        });
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : "Import unavailable.");
      }
    } finally {
      if (current()) {
        await client.invalidateQueries({
          queryKey: ["event-imports", staffUserId],
        });
        setPending(false);
      }
    }
  }
  function rowAction(
    row: ImportRow,
    operation: "skip" | "retry" | "override_duplicate",
  ) {
    if (operation === "override_duplicate" && row.duplicate_digest) {
      void run({
        operation,
        batchId,
        rowId: row.id,
        digest: row.duplicate_digest,
      });
    } else if (operation !== "override_duplicate") {
      void run({ operation, batchId, rowId: row.id });
    }
  }
  if (q.isPending) return <p role="status">Loading import…</p>;
  if (q.isError || !q.data) {
    return (
      <section>
        <h1>Import unavailable</h1>
        <button onClick={() => void q.refetch()}>Retry</button>
      </section>
    );
  }
  const { batch, rows, counts, isOwner } = q.data,
    closed = ["cancelled", "failed", "completed", "completed_with_skips"]
      .includes(batch.state);
  return (
    <section className="event-imports">
      <Link to="/moderation/event-imports">All imports</Link>
      <h1>{batch.filename}</h1>
      <p>{batch.state.replaceAll("_", " ")}</p>
      <p aria-live="polite">
        {Object.entries(counts).map(([s, n]) =>
          `${n} ${s.replaceAll("_", " ")}`
        ).join(" · ")}
      </p>
      {batch.error_code && (
        <p role="alert">
          {batch.error_code.replaceAll("_", " ")}. Fix the file and upload it
          again.
        </p>
      )}
      <div className="event-imports__actions">
        <button
          disabled={pending || closed}
          onClick={() => void run({ operation: "continue", batchId })}
        >
          {pending ? "Working…" : "Continue"}
        </button>
        <button
          disabled={pending || closed}
          onClick={() =>
            setSelected(
              rows.filter((r) => r.state === "ready").map((r) => r.id),
            )}
        >
          Select ready rows on this page
        </button>
        <button
          disabled={pending || selected.length === 0 || closed}
          onClick={() =>
            void run({
              operation: "select_import",
              batchId,
              rows: rows.filter((r) =>
                selected.includes(r.id) && r.duplicate_digest
              ).map((r) => ({
                rowId: r.id,
                expectedRevision: r.revision,
                expectedDuplicateDigest: r.duplicate_digest!,
              })),
            })}
        >
          Import Selected ({selected.length})
        </button>
        <button disabled={pending} onClick={() => void q.refetch()}>
          Refresh
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {!isOwner && (
        <p>
          Awaiting official organizer review. Imported drafts remain private
          until the official organizer completes the normal publishing flow.
        </p>
      )}
      <EventImportReviewTable
        rows={rows}
        selected={selected}
        onSelect={(id) =>
          setSelected((s) =>
            s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
          )}
        onAction={rowAction}
        pending={pending || closed}
        isOwner={isOwner}
      />
      <nav aria-label="Import pages">
        <button
          disabled={pending || offset === 0}
          onClick={() => {
            setOffset(Math.max(0, offset - 50));
            setSelected([]);
          }}
        >
          Previous
        </button>
        <span>
          Rows {Math.min(offset + 1, batch.row_count)}–{Math.min(
            offset + 50,
            batch.row_count,
          )} of {batch.row_count}
        </span>
        <button
          disabled={pending || offset + 50 >= batch.row_count}
          onClick={() => {
            setOffset(offset + 50);
            setSelected([]);
          }}
        >
          Next
        </button>
      </nav>
      {!closed && (
        <details>
          <summary>Cancel remaining import</summary>
          <p>
            Already created drafts are preserved. Remaining rows will be
            skipped.
          </p>
          <button
            disabled={pending}
            onClick={() => void run({ operation: "cancel", batchId })}
          >
            Confirm cancellation
          </button>
        </details>
      )}
    </section>
  );
}
