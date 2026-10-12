# Scripts

All operational scripts are subcommands of the `foodaccess` CLI (`backend/app/cli.py`), so they share configuration,
logging, and tests. Run them from `backend/` (or anywhere once the package is installed).

| Task | Command |
|---|---|
| Import Title I + meal eligibility + ACS data (Phase 0) | `foodaccess title-i [--offline]` |
| Generate the pilot selection report | `foodaccess pilot-report` |
| Download boundaries + ZIP centroids | `foodaccess import-reference` |
| Migrate + sync registries | `foodaccess bootstrap` / `foodaccess sync-registry` |
| Import resources for one jurisdiction | `foodaccess ingest --jurisdiction prince-william-county` |
| Refresh all enabled sources in the active scope | `foodaccess ingest [--offline] [--geocode]` |
| Import one source | `foodaccess ingest --source pwc-cmn-resources` |
| Re-validate staged data | `foodaccess validate` |
| Identify potential duplicates | `foodaccess dedupe` |
| Review-queue summary | `foodaccess review-queue` |
| Quality reports | `foodaccess quality-report [--jurisdiction ID]` |
| Freshness / recheck stale | `foodaccess mark-stale`, `foodaccess recheck-stale` |
| Pilot evaluation report | `foodaccess evaluate-pilot` |
| Machine translation (self-hosted) | `foodaccess translate --lang es` |
| Admin account | `foodaccess create-admin --email …` |
| Local demo (synthetic) | `foodaccess demo --reviewer-email …` |

`cron.example` shows a schedule.
