# Turning on Lantern's AI features (Claude Sonnet)

The app works fully without AI. With a key, these features turn on:
- "Describe what you need" search
- "Paste your announcement" drafts in the provider portal
- AI-suggested hours and eligibility (with quoted evidence) in the review queue
- Optional translation of provider text

## Option A: upload the key in the admin dashboard (easiest)

1. Sign in as an admin and open **Admin → AI settings** (`/admin/ai`).
2. Paste your Anthropic API key (it starts with `sk-ant-`) and click **Save & test**.
   - The key is encrypted before it is stored, using `FOODACCESS_SECRET_KEY`, or a local `data/secret.key` in
     development. It is never shown again (only the last 4 characters), never logged, and never written to the audit
     trail.
   - The page checks the key with Anthropic's Models API, which uses no tokens, and shows whether it works.
3. Choose the model. The default is **Claude Sonnet 5.5 (`claude-sonnet-5-5`)**; Opus 5.5 and Haiku 5.5 are also
   available. Use the toggle to turn AI on or off.

It takes effect immediately, with no restart. To remove the key, use **Remove key** on the same page.

**Production:** set `FOODACCESS_SECRET_KEY` to a Fernet key
(`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) and keep it stable.
Without that key, stored secrets can't be decrypted. Back it up separately from the database.

## Option B: environment variable

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # never commit this
export FOODACCESS_AI_ENABLED=true
export FOODACCESS_AI_MODEL=claude-sonnet-5-5
```

A key uploaded by an admin takes priority over the environment variable.

## Cost controls

- Public AI search is limited per IP address (`FOODACCESS_AI_PUBLIC_SEARCH_PER_HOUR`, default 30).
- Provider drafts are limited to 60 per user per hour.
- Each request sends only short text: a search query, an announcement, or a listing's source text.
- No conversation history is kept.

## What is sent to Anthropic

Only the typed search words, a provider's pasted announcement, or public source text for a listing. Accounts, emails,
IP addresses, and locations are never sent. Results are drafts or filters that a person confirms; see
`docs/architecture/LANTERN_FEATURES.md` (AI section) for the safeguards built into the code.
