# Backup and Restore

This guide covers backing up and restoring a `miwifi-webui` installation.

## What is backed up

A complete installation consists of:

1. **PostgreSQL data** — users, sessions, routers, sealed router
   credentials, devices, history, audit, investigations.
2. **APP_MASTER_KEY** — the envelope master key. Without it, sealed router
   credentials in the database are **permanently unrecoverable**.
3. **Configuration** — environment variables (`.env` / compose environment).

The master key must be stored **separately** from the database backup
(plan section 16): a database backup alone is not sufficient, and a key
stored inside the same backup defeats the encryption boundary.

## Backup

### PostgreSQL

From the host:

```bash
docker exec -t miwifi-webui-postgres pg_dump -U miwifi -d miwifi -F c -f /tmp/miwifi.dump
docker cp miwifi-webui-postgres:/tmp/miwifi.dump ./miwifi-$(date +%Y%m%d).dump
```

`-F c` (custom format) enables parallel restore and selective objects.

### Master key

Store `APP_MASTER_KEY` in your password manager / secret storage, NOT in
the same location as the database dump:

```bash
# Print it once; record it somewhere durable and separate.
echo $APP_MASTER_KEY
```

Rotate the master key only through an explicit future migration task —
there is no automated rotation in v1; rotating without re-sealing
credentials would render them unrecoverable.

## Restore

1. Start a fresh PostgreSQL (compose volume may be reset):

   ```bash
   docker compose down
   docker volume rm miwifi-webui_postgres-data
   docker compose up -d postgres
   ```

2. Restore the dump:

   ```bash
   docker cp ./miwifi-YYYYMMDD.dump miwifi-webui-postgres:/tmp/restore.dump
   docker exec -t miwifi-webui-postgres pg_restore -U miwifi -d miwifi --clean --if-exists /tmp/restore.dump
   ```

3. Restore `APP_MASTER_KEY` into the environment (`.env` / compose env).

4. Start the API and verify:

   ```bash
   docker compose up -d
   curl -s http://127.0.0.1:3001/api/ready
   # {"status":"ok","checks":{"database":true}}
   ```

## What a backup contains (sensitivity)

Database backups contain network metadata, device history, audit history,
and **encrypted** router credentials. Treat backups as sensitive:

* store them with restricted permissions;
* do not copy them to untrusted storage;
* remember the master key is the decryption boundary — anyone holding
  both the backup and the key can decrypt router credentials.

## Retention and backup interaction

Retention purges (telemetry ~90 days, presence/audit ~365 days,
investigation ~30 days by default) delete rows from the live database
only. Old rows may still exist inside older backups — keep backup
retention aligned with your data-hygiene requirements.
