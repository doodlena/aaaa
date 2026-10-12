# Demo guide (Congressional App Challenge video and live demo)

Everything shown in the demo uses **fictional `[TEST]` pantries**, so you can demonstrate live posting without touching
real organizations. Say this on camera. The real pilot data (113 imported listings) stays in the admin queue until
it is verified.

## Setup (once)

```bash
cd backend
../.venv/bin/lantern bootstrap
FOODACCESS_ADMIN_PASSWORD='choose-a-password' ../.venv/bin/lantern create-admin --email admin@example.org
FOODACCESS_DEMO_PASSWORD='choose-another-one' ../.venv/bin/lantern demo --reviewer-email admin@example.org --pantry-email pantry@example.org
FOODACCESS_SHOW_SYNTHETIC=true ../.venv/bin/uvicorn app.main:app --port 8000
cd ../frontend && npm run dev     # http://localhost:5173
```

The optional AI features need `FOODACCESS_AI_ENABLED=true` and `ANTHROPIC_API_KEY=...` set before starting the API.

## 3-minute story

1. **The problem (20 s).** Families make trips to pantries that turn out to be closed or out of food. Directory apps
   show hours someone typed in months ago. Pantries have no easy way to say "we're out of milk today."
2. **A family's view (60 s).**
   - Open the home page and point to "Today's shelves near you": live posts from pantries with "posted 2 h ago".
   - Search ZIP 22204. Filter "On the shelf today → Fruits & vegetables". Point out that the map pins show live status
     with icons and text, not color alone.
   - Open the Maple pantry. Show **Today at this pantry**, then the **visit planner**: "Bring" / "Not needed
     (confirmed)" / "Ask the pantry". Unknown requirements are never shown as "not needed".
   - Click **Add to calendar** and **Print visit card**.
   - Switch to **Español**.
3. **The pantry's view (60 s).** Sign in as the demo pantry account and open **For pantries**.
   - Tap **Limited**, set eggs to "low", and post. Reload the public page to show it updated instantly.
   - With AI enabled: paste "Drive-thru this Saturday 9-11am, bring ID!", show the AI draft with fields to check, and
     post it. With AI off, fill the event form by hand.
   - Show the **surplus board**: "40 cases of canned beans" offered to other pantries.
4. **Trust and safety (30 s).** File **Report a problem** as a guest; no account or personal data is needed. As an
   admin, show the access-request queue (staff are confirmed by phone), the community-reports queue, and a change
   proposal labelled **provider** or **AI-suggested** with its quoted evidence.
5. **Engineering (10 s).**
   - Pilot chosen from Virginia Title I and Census data.
   - Imports 4 public data feeds and never overwrites verified data.
   - 95+ backend tests, frontend unit tests, and end-to-end browser tests.

## Questions judges often ask

- **How do you know the info is right?** Every public listing has a named reviewer's verification and its sources.
  Live posts come only from approved pantry staff and expire on their own. Community reports trigger re-checks.
- **What does the AI do?** It only drafts. A person approves everything, and extracted facts must quote the source
  text or they are thrown away.
- **Privacy?** Families never need an account. Device location stays in the browser. Reports store no identity. There
  are no trackers.
- **Cost?** All software is free and open source. AI is optional. Hosting can use Docker Compose on a small server.
