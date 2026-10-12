# Administrator verification guide

## Roles

Create an administrator with `foodaccess create-admin --email you@org`. It prompts for a password of at least 12
characters, or reads `FOODACCESS_ADMIN_PASSWORD`. Admin API routes check the role on the server for every request;
write requests also require the CSRF header. Every verification action is stored with the reviewer's account and
cannot be anonymous.

## States

```
candidate ──flag──▶ needs_review ──verify(method)──▶ verified ──publish──▶ (public)
    │                    ▲                               │
    └──reject──▶ rejected │◀── material import change ────┘   verified ──(> FRESH_DAYS)──▶ stale (still public, labelled)
                          └──────── record missing from source
operating_status: open | temporarily_closed | permanently_closed (unpublishes) | unknown
```

- **verify** requires a method: `phone`, `email`, `website`, `in_person`, `official_source`, or `provider_submission`.
  It is blocked while source changes are pending.
- **publish** requires `verified` or `stale` status, coordinates, at least one source record, and publication rights.
  Rights come either from a source marked `permitted_with_attribution` or from a latest verification made directly
  with the provider (phone, email, in person, or provider submission).
- **reject**, **flag**, **close_temporary**, **close_permanent**, **reopen**, and **unpublish** are all recorded as
  verification records with a snapshot.

## Reviewing a listing (Admin → Queue → listing)

1. Open the **source record(s)**: raw values (when storage is permitted), normalized values, and validation issues.
   Open the source URL.
2. Open the **official website** if one is known. If none is known, leave it blank; never substitute a directory page.
3. Check the **address and map pin**.
4. Confirm **distribution days and times**. These are separate from office hours, which are optional.
5. Confirm each **eligibility condition** as Required, Not required (confirmed), or leave it Not confirmed. Never mark
   "not required" because a source is silent.
6. Confirm **services and food types** actually documented for *this site*.
7. Resolve **change proposals** (current vs proposed, with source) and **duplicate candidates** (merge or distinct).
8. **Verify** (choose the method, add notes such as "Called 703-… spoke with coordinator"), then **Publish**.

## Freshness

`FOODACCESS_VERIFICATION_FRESH_DAYS` defaults to 90. `foodaccess mark-stale` (run daily from cron) labels older
listings as `stale`. They stay public with a "needs re-check" label and appear in the queue's stale filter.
`foodaccess recheck-stale` re-imports their sources. An unreachable website or a record missing from a source is a
reason to investigate; nothing closes a listing automatically.

## Recommended pilot audit

Before expansion, verify at least 25% of real candidates in each pilot jurisdiction, chosen randomly within each
source. This is the threshold `foodaccess evaluate-pilot` checks. Record which fields were wrong in the verification
notes. The per-source completeness table in the evaluation report shows which adapters need work.
