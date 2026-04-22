# Notion Time Tracker

Minimalist cross-platform desktop app (Mac + Windows) that tracks time against
your Notion tasks and writes a new entry to your Work Sessions database every
time you stop the timer.

- **Tasks grouped by due date** — Overdue / Today / Tomorrow / This week / Later / No due date
- **Live `HH:MM:SS` timer** with one active session at a time
- **Auto-sync to Notion** — creates a `Session: <task>` page with Start Time, End Time, Team Member, and Task relation; Duration is computed by your existing formula
- **Multi-teamspace aware** — discovers every Work Sessions sub-database inside the parent page and pairs it with its Tasks database automatically
- **Offline queue** — if Notion is unreachable, sessions are saved locally and retried on next launch
- **Token stays local** — the Notion integration token is stored in the OS-specific app data folder, never in this repo

## Stack

- Electron 33 + Vite 5 + React 18 + TypeScript
- Tailwind CSS (dark, minimalist)
- `@notionhq/client` for the Notion REST API
- Packaged with `electron-builder` (DMG for Mac, NSIS for Windows)

## Development

Requires Node 20+.

```bash
npm install
npm run dev    # starts Vite + Electron in watch mode
```

Typecheck only:

```bash
npm run lint
```

## Build installers

```bash
npm run pack:mac    # -> release/*.dmg and *.zip
npm run pack:win    # -> release/*.exe (installer) and portable
npm run pack:all    # both (requires appropriate host / signing configured)
```

Unsigned Mac builds: first launch requires right-click → **Open** once to bypass Gatekeeper.

## First-run setup

1. **Create a Notion internal integration**
   - Go to <https://www.notion.so/profile/integrations>
   - Click **+ New integration**, name it `Time Tracker`, select your workspace
   - Type: **Internal**
   - Capabilities: Read content, Update content, Insert content
   - Copy the **Internal Integration Secret** (starts with `ntn_...`)

2. **Share the databases with the integration**
   For the Work Sessions parent page AND every Tasks database per teamspace:
   - Open the page → `•••` → Connections → **Connect to** → `Time Tracker`

3. **Launch the app** — it opens directly in Settings on first run:
   - Paste the integration token
   - Click **Load people from workspace** → pick yourself
   - Confirm / edit the Work Sessions parent URL
   - Click **Discover databases** → the app lists every pairing it found
   - (Optional) narrow by Task `Type`
   - **Save** → you're in the task view

## Notion schema expected

**Tasks database** (one per teamspace):

| Property | Type | Required |
| --- | --- | --- |
| `Name` | title | ✓ |
| `Due` | date | – (no date is OK, shows in "No due date") |
| `Status` | status | ✓ (`Complete` and `Blocked` are filtered out) |
| `Assignee` | person | ✓ for filtering |
| `Priority` | select (`Urgent` / `High` / `Normal` / `Low`) | – |
| `Type` | select (`To do List` / `Scorecard` / `Weekly Report` / `Time Tracking Tasks`) | – |

**Work Sessions database** (one per teamspace, must sit inside the Work Sessions parent page):

| Property | Type |
| --- | --- |
| `Name` | title |
| `Start Time` | date |
| `End Time` | date |
| `Duration (minutes)` | formula — `dateBetween(prop("End Time"), prop("Start Time"), "minutes")` |
| `Team Member` | person |
| `Task` | relation → matching Tasks database |

## Config storage

Settings live in the OS-standard userData directory:

- **macOS:** `~/Library/Application Support/notion-time-tracker/`
- **Windows:** `%APPDATA%\notion-time-tracker\`

Files:
- `config.json` — Notion token, selected user, pairings, filters
- `queue.json` — pending Work Session writes awaiting retry

Both are in `.gitignore`. The token never leaves your machine.

## License

MIT
