# Wheretoo V1 prepared icon pack

This importer installs the nine user-approved assets in `Wheretoo_V1_Map_Icons_Prepared.zip` through the existing catalog and immutable Storage workflow. It does not bundle images into the application, change event assignments, alter database authorization, or enable hosted feature switches.

## Verify the supplied ZIP

```sh
ICON_PACK_ZIP="$HOME/Downloads/Wheretoo_V1_Map_Icons_Prepared.zip" pnpm icons:v1:verify
```

The archive SHA-256 is pinned to `50994df778200cfe3855f5a03be04578a6bdfa235683ff42e32587cde97317ea`. All nine source images and runtime images must match the reviewed hashes in `v1-pack.json`; every runtime PNG is decoded and checked before any login or mutation. An altered/repacked ZIP is rejected for review, even if its filenames match.

## Local import

Run `pnpm icons:v1:import` with these environment variables supplied through a trusted terminal or local secret file:

- `ICON_PACK_ZIP`: absolute path to the approved ZIP.
- `ICON_API_URL`: dedicated isolated API, exactly `http://127.0.0.1:64321` or `http://127.0.0.1:56321`.
- `ICON_PUBLIC_KEY`: that isolated stack's anonymous API key.
- `ICON_SERVICE_KEY`: its server-only Storage credential.
- `ICON_ADMIN_EMAIL`, `ICON_ADMIN_PASSWORD`: an authenticated active staff admin in that stack.

No secret belongs in a browser environment variable, committed file, or shell history. For the explicitly approved staging rollout only, set `ICON_STAGING_PROJECT_REF=oznjmliqnczotunksafx` and `ICON_API_URL=https://oznjmliqnczotunksafx.supabase.co`. The importer refuses every other hosted target, requires both rendering and selection disabled before installation, and leaves activation to the operator after all nine readbacks succeed. Verify the project name is `wheretoo-staging` through the management API before invoking it. Never supply actual production credentials.

The importer validates all assets first, prepares packages with deterministic request IDs, verifies canonical Storage paths, uploads without overwriting, reads back exact bytes, follows validated -> approved -> published transitions, and verifies anonymous public delivery's hash, MIME type, cache headers, and CORS. Interrupted imports can be rerun. Missing/corrupt published objects fail closed and are not silently repaired.

## Provenance

The **prepared PNG** is the approved ingestion original. The stored identity crop is exactly the same PNG, with coordinates `[0, 0, width, height]`; the importer does not claim the cleaned/resized image is a pixel-identical crop of the upstream artwork. Private `original.png` and `crop.png` therefore contain the approved prepared export. The upstream originals remain byte-for-byte intact in the supplied ZIP. Their hashes and the full preparation/crop history are preserved in `v1-pack.json`, and the importer checks those original bytes before publication. The audit reason binds the operation to the approved archive hash.

No full-resolution upstream artwork is copied into the public bucket. Keep the supplied original and prepared ZIPs backed up outside the repository. Asset binaries are intentionally not duplicated in Git.

## Placement and quality

Each PNG remains unchanged. Metadata uses its supplied ground-contact point, 3x density, bottom anchoring and an 8% selected emphasis. Desktop artwork grows from 48 to 88 CSS pixels with zoom; mobile grows from 48 to 80. The selected maximum is below the existing 96px envelope.

Existing renderer budgets are preserved: up to 16 active icon versions on desktop and 8 on mobile, with 64/32 MiB decoded-image limits. If nine distinct types are simultaneously visible on mobile, one uses the standard marker; selecting it prioritizes its custom artwork. Installing nine choices does not remove these performance limits.

Existing assignments to earlier published versions remain intact. The new Wheretoo Flag becomes the current selectable version of that slug; prior versions are not deleted. Revoke or retire versions through the existing staff transition workflow for rollback, never by replacing immutable bytes.
