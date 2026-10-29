# Projects board (`/projects`)

One screen with every project in Rankify, Personal, ITM and Hiatus Collection.
It is read-only. Each area's hub stays the source of truth. Tom Hub calls each
hub live from the server (`/api/life-projects`), reshapes the response into
cards and stores nothing. The only cache is 60 seconds in memory, and it is
never written to KV. Nothing is written back to any hub.

- **Login:** the page is behind `middleware.js`, so it needs the server-checked
  `tom_session` cookie from `/login`. The API also checks the session (or the
  `ROUTINE_SECRET` bearer key) itself.
- **Keys:** keys live only in Vercel env vars, are used only server-side, and
  are never returned to the browser.
- **Lane failures:** each lane fails on its own and shows "Needs a read-only
  key", "Needs a projects endpoint" or "Hub not reachable".

## Env vars

| Var | Lane | Notes |
|---|---|---|
| `RANKIFY_CRM_READ_KEY` | Rankify | Preferred. A read-only CRM key. Falls back to the existing `CRM_ADMIN_API_KEY`, which works for `/api/projects` but is rejected (401) by `/api/routine`, so clients, to-dos and the projects space need this key. |
| `HIATUS_HUB_READ_KEY` | Hiatus | A read-only bearer for `GET /api/agent?sections=tasks,projects`. |
| `ITM_COMMAND_CENTRE_KEY` | ITM | A bearer for `POST /api/bot {action:"list_businesses"}`, ideally a read-only bot key. |
| `RANKIFY_CRM_URL`, `HIATUS_HUB_URL`, `ITM_COMMAND_CENTRE_URL` | all | Optional URL overrides. |

## What each hub is read for

- **Rankify CRM:**
  - `GET /api/projects` returns the client builds with their stage timeline, "you are here" and open to-dos.
  - `POST /api/routine` is called with `list_clients` (active clients that have no project card), `list_space todos` and `list_space projects` (products and internal work).
- **Hiatus Hub:** `GET /api/agent?sections=tasks,projects&period=all`. There is no `projects` section yet, so only open Hub tasks show.
- **ITM Command Centre:** `POST /api/bot list_businesses`. Each workspace becomes one card, and its next step is the most urgent open item.
- **Personal (Tom Hub KV):**
  - `tom_todos`, grouped into projects
  - the `tom_brain` approval queue
  - `tom_goals`
  - the new personal-only `projects` space (`tom_projects`), writable via `/api/routine`

## Proposed upstream shape (not built; each hub needs its own approval)

A read-only `projects` list in each hub, kept by that area's bots:

```json
{ "projects": [ {
  "id": "string", "name": "string", "type": "Client build | Product | System | ...",
  "stages": ["Plan", "Build", "Live"], "stageIndex": 1,
  "where": "short 'where it's at'", "next": "the next step",
  "implementNext": ["after that", "and then"],
  "due": "YYYY-MM-DD", "blocker": "what it's waiting on", "owner": "bot or person"
} ] }
```

- **Hiatus Hub:** add `projects` as a section of `GET /api/agent`, read with a read-only key.
- **ITM Command Centre:** add a read-only `list_projects` bot action, or a read-only key scope for `list_businesses`.
- **Rankify CRM:** the `projects` space already exists. Bots fill it with the same fields above.
