import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffContext } from "../moderation/staffContext";
import { captureIdentityLifetime } from "../auth/identityLifetime";
import { useImports } from "./eventImports.queries";
import { uploadImport } from "./eventImports.api";
import "./eventImports.css";
const template =
  "title,description,category,start_date,start_time,end_date,end_time,venue_name,address,city,postal_code,capacity,source_url,source_name,notes\n";
export function EventImportsPage() {
  const { staffUserId } = useStaffContext(),
    client = useQueryClient(),
    navigate = useNavigate(),
    query = useImports(staffUserId);
  const [file, setFile] = useState<File | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function upload() {
    if (!file || pending) return;
    const current = captureIdentityLifetime(client, staffUserId);
    setPending(true);
    setError("");
    try {
      if (file.size > 2097152) {
        throw Error("Choose a CSV file of at most 2 MiB.");
      }
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (!current()) return;
      const key = `event-import-upload:${staffUserId}:${digest}:${file.name}`;
      const requestId = sessionStorage.getItem(key) ?? crypto.randomUUID();
      sessionStorage.setItem(key, requestId);
      const r = await uploadImport(file, requestId, current);
      if (current()) {
        sessionStorage.removeItem(key);
        await client.invalidateQueries({
          queryKey: ["event-imports", staffUserId],
        });
        navigate(`/moderation/event-imports/${r.batchId}`);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : "Upload unavailable.");
      }
    } finally {
      if (current()) setPending(false);
    }
  }
  function download() {
    const u = URL.createObjectURL(new Blob([template], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = "wheretoo-event-import-template.csv";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <section className="event-imports">
      <h1>CSV event imports</h1>
      <p>
        Create free event drafts for the official Wheretoo organizer. The
        organizer reviews and publishes each event.
      </p>
      <p>
        UTF-8 CSV · maximum 500 rows · 2 MiB. Times use America/Los_Angeles.
        Correct invalid rows in your CSV and upload again.
      </p>
      <button onClick={download}>Download CSV template</button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <label>
          CSV file<input
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError("");
            }}
          />
        </label>
        <button disabled={!file || pending}>
          {pending ? "Uploading…" : "Upload CSV"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <h2>Recent imports</h2>
      {query.isPending
        ? <p role="status">Loading imports…</p>
        : query.isError
        ? (
          <div role="alert">
            Imports unavailable.{" "}
            <button onClick={() => void query.refetch()}>Retry</button>
          </div>
        )
        : query.data.length === 0
        ? <p>No imports yet.</p>
        : (
          <ul>
            {query.data.map((b) => (
              <li key={b.id}>
                <Link to={`/moderation/event-imports/${b.id}`}>
                  {b.filename}
                </Link>{" "}
                — {b.state.replaceAll("_", " ")} · {b.row_count} rows
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
