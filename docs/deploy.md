# Deploying Mifluent

One server, one `docker compose up`. The same files are the self-host
artefact: what runs the hosted beta is exactly what anyone else runs.

Sized for a VPS with 1 CPU and 4 GiB of memory (Ubuntu 24.04). The containers
are limited to about 2.5 GB together — database 512 MB, web 768 MB, worker 1 GB,
Caddy and backups 128 MB each — leaving the rest to the system.

## From a clean server to the first digest

1. **Install Docker.**

   ```sh
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker "$USER" && newgrp docker
   ```

2. **Get the code.**

   ```sh
   git clone https://github.com/prostoMif/mifluent.git && cd mifluent
   ```

3. **Create the configuration.**

   ```sh
   cp .env.production.example .env
   ```

4. **Fill in the required values** in `.env`: `PUBLIC_HOST` (and the same
   host in `BETTER_AUTH_URL` and `APP_URL`), `POSTGRES_PASSWORD`,
   `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `BACKUP_PASSPHRASE`, and the
   `LLM_*` block. Each line in the file says how to generate its value.
   Without a domain, `PUBLIC_HOST` is the server's IP with dashes plus
   `.sslip.io`, for example `203-0-113-7.sslip.io`.

   **Copy `.env` somewhere safe that is not this server.** `ENCRYPTION_KEY`
   and `BACKUP_PASSPHRASE` cannot be recovered, and a backup is useless without
   its passphrase.

5. **Start it.**

   ```sh
   docker compose up -d
   ```

   The first build takes several minutes. If it runs out of memory on a
   1-CPU / 4 GiB server — `next build` is the heavy step — see *Building
   elsewhere* below.

6. **Watch the migrations run.**

   ```sh
   docker compose logs -f migrate
   ```

   It prints `migrate.finished` and exits. `web` and `worker` start after it.

7. **Open `https://<PUBLIC_HOST>`.** The first visit may take a minute while
   Caddy obtains the certificate.

8. **Create the owner account at once.** The first account on an instance is
   always allowed and becomes its owner. On a public address, do this before
   anything else. After it, people join by invitation (Settings).

9. **Link Telegram** (optional). Set `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` in `.env`, then:

   ```sh
   docker compose up -d
   docker compose exec worker npm run telegram:webhook --workspace @mifluent/worker
   ```

10. **Start watching.** *Watching → Start with your website*. The first digest
    appears on *Today* within a few minutes; link Telegram from there.

## Checking it

```sh
docker compose ps                      # all healthy, migrate exited 0
curl -fsS https://$PUBLIC_HOST/api/health
docker stats --no-stream               # memory against the limits above
docker compose logs --since 1h worker  # what the worker did
```

The worker's first poll downloads the embedding model (~120 MB) into the
`models` volume. That happens once.

## Updating

```sh
git pull
docker compose up -d --build
```

Migrations run automatically before the new `web` and `worker` start.

## Backups

The `backup` container writes an encrypted dump every day at 03:00 UTC to the
`backups` volume and keeps the last seven.

Take one now:

```sh
docker compose exec backup mifluent-backup --now
docker compose exec backup ls -l /backups
```

Copy them off the server regularly — a backup on the same disk as the
database does not survive losing the disk:

```sh
docker compose cp backup:/backups ./backups-$(date +%F)
```

Keep `BACKUP_PASSPHRASE` somewhere else than the copies.

### Restoring

```sh
scripts/restore.sh mifluent-20260924T030000Z.sql.gz.enc
```

It asks for confirmation, stops `web` and `worker`, replaces the database with
the backup, runs migrations, and starts them again.

**Test a restore before you need one**: on a copy of the server (or locally
with the same compose file), restore last night's backup and sign in. An
untested backup is not a backup.

## Building elsewhere

If `docker compose build` fails for memory on the server, build on a bigger
machine and copy the images:

```sh
# on your machine, in the repository
docker compose build
docker save mifluent:latest mifluent-backup:latest | gzip | ssh you@server 'gunzip | docker load'

# on the server
docker compose up -d --no-build
```

## What runs where

| Service   | What it does                                                |
|-----------|-------------------------------------------------------------|
| `db`      | PostgreSQL 17 with pgvector. Data in the `postgres-data` volume. |
| `migrate` | Applies database migrations, then exits.                     |
| `web`     | The application and its API, on port 3000 inside the network. |
| `worker`  | Polling, the pipeline, digests, Telegram delivery.          |
| `caddy`   | HTTPS on ports 80 and 443, certificates in `caddy-data`.    |
| `backup`  | Daily encrypted `pg_dump` into the `backups` volume.         |
