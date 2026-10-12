# Lantern: what makes it different

Most food-assistance apps are **directories**: a list of addresses and hours that someone typed in once, and that go
stale. Lantern is a **live, two-way connection**:

| | Typical finder directory | Lantern |
|---|---|---|
| Who updates it | The directory maintainer | **The pantries themselves**, through a portal, plus verified official data |
| What families see | Static hours | **Today's status and what's on the shelf**, with "posted 2 h ago". Status expires automatically. |
| When info is wrong | Nothing happens | **Anyone can report it** without an account. Repeated reports send the listing back for re-checking, and the pantry sees the reports. |
| Unknown requirements | Often shown as blank, so they look like "none" | **Tri-state**: required / not required (confirmed) / not confirmed, which turns into "Ask the pantry" in the visit planner |
| Planning a visit | Address and phone number | **What-to-bring checklist**, add-to-calendar, printable or shareable visit card, works offline |
| Pantry-to-pantry | — | **Surplus board**: pantries offer extra food, and nearby pantries claim it |
| AI | — | **Optional, human-in-the-loop** drafting (below) |

## Pantry portal: trust model

Signed-out visitors to `/pantry` see a page explaining what services can do and how access works (guide for providers:
`docs/providers/PROVIDER_GUIDE.md`).

1. A signed-in person requests access to a listing. They give a role and how to reach them. Limits: 10 requests per
   hour and 10 waiting at once per person; role ≤120 and note ≤1,000 characters.
2. An admin confirms the person **by calling the pantry's listed phone number**, then approves the request. Every
   decision is in the audit log. The admin menu shows a badge with the number of waiting requests (there is no email
   service). A decline can carry a reason, which the requester sees on their portal page; they can then send the
   request again with better details. A pending request can be withdrawn. Access an admin *removed* (revoked) can only
   be restored by an admin.
3. Approved staff can:
   - **Post live status** (open / limited / out / closed) and **items with stock levels** (plenty / some / low).
     These publish immediately as "Posted by the pantry". They come from approved staff and expire on their own (end
     of day by default, at most 3 days).
   - **Post pop-up events and closures.** These also publish immediately and are labelled. A closure removes that day's
     distribution window everywhere, including search, the visit planner, and calendar exports.
   - **Suggest corrections** to hours, eligibility, or contact details. These go into the review queue as change
     proposals (`origin=provider`) and **never overwrite verified data directly**.
   - **Answer community reports** and use the **surplus board**.
   - **Add colleagues** who already have an account (no email is sent), and remove them. The added membership records
     who vouched for it (`added_by_id`) and is audited. Admins can still revoke anyone.
   - **Confirm the listing is correct.** This records a `verify` action with method `provider_submission`, attributed
     to that admin-approved person, so the listing shows as verified with today's date. It is refused while change
     proposals are still pending, so a provider can't confirm data that is about to change.

Every `/api/provider/locations/{id}/…` endpoint checks the caller is approved staff for **that** listing (or an admin);
`tests/test_provider_portal.py` checks each one returns 403 for another listing. Writes need the session's CSRF token.

## Community reports

`POST /api/resources/{id}/reports` takes a kind (was closed / wrong info / out of food / other) and an optional
500-character note, with markup stripped. **No account, IP address, or location is stored.** The IP address is used
only in memory for rate limiting (5 per hour). Three open "was closed" or "wrong info" reports within 7 days
(configurable) send a verified listing to `needs_review`. It stays public, labelled "needs re-check", until a reviewer
acts.

## Optional AI (Claude)

AI is **off by default**, and the app is complete without it. To turn it on, set `FOODACCESS_AI_ENABLED=true`, set
`ANTHROPIC_API_KEY`, and run `pip install -e "backend[ai]"`. The model is configurable with `FOODACCESS_AI_MODEL`
(default `claude-sonnet-5-5`). Implementation: `backend/app/services/ai.py`, which uses the official `anthropic` SDK
with structured outputs (`messages.parse`).

| Feature | Who uses it | What Claude receives | What happens with the output |
|---|---|---|---|
| **Paste your announcement** | Pantry staff | The text they pasted, today's date, and the pantry name | A **draft** status, event, or closure pre-fills the form, plus a list of things to double-check. Nothing posts until staff click. Posts are marked `ai_assisted`. |
| **Hours and eligibility suggestions** | Reviewers (`POST /api/admin/resources/{id}/ai-suggestions`, `lantern ai-suggest`) | Public free text from source records | Pending **change proposals** with `origin=ai`. **Every schedule or requirement must quote verbatim evidence; anything whose quote is not literally in the source text is discarded in code.** A reviewer accepts or rejects. |
| **Describe what you need** search | Public (rate-limited) | Only the words typed, never location or account | Converted into the app's normal filters. Results still come only from verified database listings. The UI says an AI service was used. |
| **Translation** | CLI (`FOODACCESS_TRANSLATION_PROVIDER=claude`) | Provider descriptions | Stored as an unreviewed machine translation next to the original. Eligibility status is never machine-translated. |

Guardrails enforced in code:
- Outputs must match a schema whose enums come from the app's vocabularies, so the model cannot make up a food type or
  filter.
- Input is wrapped and labelled as untrusted data, which guards against prompt injection from scraped pages or pasted
  posts.
- Refusals, network errors, and rate limits return HTTP 503, and the UI falls back to manual entry.
- Per-user and per-IP rate limits cap cost.

Every guardrail is tested with a fake client (`backend/tests/test_lantern_features.py`), so the tests need no key and no
network.

## Accessibility and privacy carry over

Status is never shown by color alone: every status pairs a glyph with text. Live posts carry no personal data.
Families never need an account, and device location stays in the browser.
