# BWE Settings & Run History

## Overview

This document describes the settings and run-history functionality added to
the Big Wheel of Excitement (BWE) application.

Both features are backed by a small Express + SQLite server (`server/`) so
data survives page reloads, container restarts, and Kubernetes pod
rescheduling - see the top-level [README.md](README.md) and
[k8s/README.md](k8s/README.md) for the backend/deployment side of this.

## Features

### 1. Settings Icon (⚙️)

- Displayed top-right, in a shared floating icon cluster alongside the run
  history icon.
- Clicking it opens the settings modal, loading the current server-side
  title/subtitle/names.

### 2. Settings Modal

- **Title / Subtitle**: edit the text displayed above the wheel.
- **Wheel Names**: add, edit, or remove (🗑️) names, up to 50.
- **Save Changes**: persists to the server (`PUT /api/settings`) and applies
  immediately - the new names are fed into the live wheel via its own CSV
  upload mechanism, no page reload required.
- **Reset Fields**: clears the *form* back to blank defaults so you can start
  over; it does not touch saved data until you click Save Changes.

### 3. Run History (🏆)

- A second icon opens the Run History modal, listing every winner the wheel
  has produced (name + relative time), newest first.
- **Clear History** deletes all recorded spins (`DELETE /api/history`).
- **Export CSV** downloads the current history as a CSV file.
- Winners are captured automatically: a `MutationObserver` watches for the
  wheel's own "We Have a Winner!" overlay and records whatever name appears
  there (`POST /api/history`) - no changes to the compiled wheel bundle
  needed.
- **No repeat winners**: once the winner overlay is closed, that name is
  removed from the wheel. Drawn names stay off the wheel across page reloads
  (remembered in the browser), and the wheel is never refilled automatically.
  When one name is left, saving settings starts a new round with everyone.
- **No duplicate names**: duplicates (case-insensitive) are dropped when
  settings are saved and whenever names are loaded onto the wheel.

### 4. Persistence

- Settings and history are stored server-side in SQLite
  (`server/db.js`), under `DATA_DIR` (default `/data/bwe.db`).
- On first boot, if there's no data yet, the wheel is seeded from
  `server/seed/seed-data.json` (or a ConfigMap-mounted file in Kubernetes) so
  it's never empty.
- The browser keeps a small `localStorage` cache of the last successfully
  loaded settings purely as an offline fallback if the server is briefly
  unreachable - it is not the source of truth.

### 5. Pod/Node Info Badge

- A small badge in the bottom-left corner shows the current pod name and
  node name (via the Kubernetes Downward API, exposed at `GET /api/meta`).
- Delete the pod and reload the page: the badge shows a new pod name, but
  your names and history are unchanged - a quick visual proof that compute is
  ephemeral while the PVC-backed data isn't.

## Usage

1. **Open Settings**: click the ⚙️ icon.
2. **Edit Title/Subtitle/Names**, then **Save Changes** - changes apply to
   the wheel immediately.
3. **Open Run History**: click the 🏆 icon to review, clear, or export past
   spins.

## Technical Details

### Files

- `bwe-core.js` - shared API client, toast notifications, and the
  CSV-injection helper used to feed persisted names into the compiled wheel.
- `bootstrap.js` - loads settings on page start and renders the pod badge.
- `settings.js` / `settings.css` - the settings modal.
- `history.js` / `history.css` - the run-history modal and winner capture.
- `server/` - the Express + SQLite backend and API (see its own comments for
  schema and endpoint details).

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | Current `{ title, subtitle, names }` |
| PUT | `/api/settings` | Save settings, returns the saved copy |
| GET | `/api/history?limit=` | Recent spins, newest first |
| POST | `/api/history` | Record a winner `{ name }` |
| DELETE | `/api/history` | Clear all history |
| GET | `/api/meta` | Pod/node metadata |
| GET | `/healthz` / `/readyz` | Liveness / readiness probes |

### Browser Compatibility

- Modern browsers with ES2017+ support (`fetch`, `async`/`await`,
  `DataTransfer`).
- CSS Grid and Flexbox support.

## Notes

- The wheel names are fed into the React app's real CSV-upload input, capped
  at 50 entries (the same limit the app itself enforces).
- Title and subtitle changes update the DOM directly and take effect
  immediately on save.

## Future Enhancements

- Multi-user/auth-gated settings (a Kubernetes Secret would be a natural fit).
- Import/export full settings (not just history) as JSON.
- Live updates across open tabs via WebSocket/SSE instead of polling on open.
