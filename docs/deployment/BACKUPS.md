# Database backups

The live database (Render `lantern-db`) holds accounts, saved places, provider posts and reports. Render deletes a free
database 30 days after it is created, so a copy is taken every day and kept in private storage.

- **What runs:** `.github/workflows/backup.yml`, every day at 08:17 UTC and on demand (Actions → Database backup →
  Run workflow).
- **What it does:** dumps the whole database, encrypts the file with a passphrase, uploads it to a Backblaze B2 bucket
  as `backups/lantern-<date>-<time>.dump.gpg`, and removes backups older than 7 days.
- **What it never does:** commit the dump to this repository or attach it to the workflow run. The repository is
  public; the backup contains email addresses and password hashes.

## One-time setup

### 1. Backblaze B2

1. Keep the bucket **Private**.
2. Bucket → **Lifecycle Settings** → **Keep only the last version of the file**. Without this, files the workflow
   deletes are only hidden and stay in the bucket.
3. **Application Keys → Add a New Application Key**: allow access to **this bucket only**, type **Read and Write**.
   Copy the `keyID` and `applicationKey` (the key is shown once).
4. Note the bucket's **Endpoint** (bucket details), for example `s3.us-east-005.backblazeb2.com`.

### 2. Render

`lantern-db` → **Info** → copy the **External Database URL**.

### 3. GitHub repository secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**. Add all six:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Render External Database URL |
| `BACKUP_PASSPHRASE` | A long random passphrase you make up. **Save a copy outside GitHub** (a password manager): GitHub never shows it again, and a backup cannot be opened without it. |
| `B2_KEY_ID` | Backblaze `keyID` |
| `B2_APPLICATION_KEY` | Backblaze `applicationKey` |
| `B2_BUCKET` | Bucket name |
| `B2_ENDPOINT` | Bucket endpoint, without `https://` |

Then run the workflow once by hand and check that a file appears in the bucket.

Also keep a copy of Render's `FOODACCESS_SECRET_KEY` with the passphrase. Search preferences and saved places inside
the backup are encrypted with it; a restored database is only fully readable with the same key.

## Restoring

Needed: the backup file (download it from the bucket), the passphrase, Docker and `gpg`.

1. In Render, create the new database (or pick the one to overwrite) and copy its External Database URL.
2. **Suspend** the `lantern-api` service so nothing writes during the restore.
3. Run:
   ```bash
   PGSSLMODE=require scripts/restore-backup.sh lantern-<date>-<time>.dump.gpg "<external database url>"
   ```
   It shows the target, asks you to type the database name, then asks for the passphrase.
4. Point `lantern-api` at the database (`FOODACCESS_DATABASE_URL`), make sure `FOODACCESS_SECRET_KEY` is the same value
   as before, and **resume** the service.

The restore empties the target and loads the backup in a single transaction: if any step fails, the database is left
exactly as it was. Everything written after the backup was taken is not in it (up to a day).

## Limits

- A deleted account remains in older backup files until they age out (7 days).
- GitHub pauses scheduled workflows in a repository with no activity for 60 days; re-enable it under Actions if that
  happens.
- The dump is made with PostgreSQL 17 tools. If the database is moved to a newer major version, raise `PG_IMAGE` in the
  workflow and the restore script.
