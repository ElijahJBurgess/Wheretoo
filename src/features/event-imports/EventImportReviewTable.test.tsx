import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { EventImportReviewTable } from "./EventImportReviewTable";
describe("import review authority and inert data", () => {
  it("renders unlimited capacity and source HTML as text without foreign-owner edit links", () => {
    render(
      <MemoryRouter>
        <EventImportReviewTable
          rows={[{
            id: "r",
            record_number: 2,
            state: "imported",
            revision: 1,
            input: {
              title: "<script>unsafe</script>",
              start_date: "2027-06-01",
              start_time: "12:00",
              venue_name: "Hall",
              address: "1 Market St",
              category: "community",
              capacity: null,
            },
            errors: [],
            duplicate_candidates: [],
            duplicate_count: 0,
            duplicate_digest: null,
            resulting_event_id: "event",
            failure_code: null,
          }]}
          selected={[]}
          onSelect={vi.fn()}
          onAction={vi.fn()}
          pending={false}
          isOwner={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
    expect(screen.getByText("<script>unsafe</script>")).toBeInTheDocument();
    expect(screen.getByText("Awaiting official organizer review"))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit draft" })).not
      .toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
