# Deployment Workflow

## Target Topology

- Local development: Windows 11
- Editor: VS Code or Antigravity
- Source control: Git + private GitHub repository
- Production server: Ubuntu VPS over SSH
- App stack: Node.js + Express + SQLite + EJS
- Reverse proxy: Nginx
- Process manager: systemd

## Why This Workflow

- It matches the current app architecture.
- It is light enough for 1 CPU / 1 GB RAM.
- It avoids Redis, PostgreSQL, Docker, and CI/CD complexity until they are justified.
- It gives you a clean update path: `commit -> push -> pull -> migrate -> restart`.

## Directory Layout On VPS

- App code: `/opt/balance-checker-pro`
- SQLite database: `/var/lib/balance-checker-pro/app.db`
- Backups: `/var/backups/balance-checker-pro`
- Systemd unit: `/etc/systemd/system/balance-checker-pro.service`
- Nginx site: `/etc/nginx/sites-available/balance-checker-pro`

## Phase 1: Prepare Local Repository On Windows

Run inside the project root:

```powershell
cd D:\Projects\Code\balance-checker-pro
git status
git add .
git commit -m "Initial production-ready foundation"
```

Create a private GitHub repository, then connect it:

```powershell
git remote add origin https://github.com/<your-account>/balance-checker-pro.git
git branch -M main
git push -u origin main
```

If the remote already exists:

```powershell
git remote -v
git push -u origin main
```

## Phase 2: Prepare Ubuntu VPS

SSH into the VPS as a sudo-capable user.

Update packages:

```bash
sudo apt update && sudo apt upgrade -y
```

Install base packages:

```bash
sudo apt install -y git nginx certbot python3-certbot-nginx sqlite3
```

Install Node.js LTS. Match the major version you validated locally.

Create a dedicated service account and directories:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin balancechecker || true
sudo mkdir -p /opt/balance-checker-pro
sudo mkdir -p /var/lib/balance-checker-pro
sudo mkdir -p /var/backups/balance-checker-pro
sudo chown -R balancechecker:balancechecker /opt/balance-checker-pro
sudo chown -R balancechecker:balancechecker /var/lib/balance-checker-pro
sudo chown -R balancechecker:balancechecker /var/backups/balance-checker-pro
```

## Phase 3: Clone Project On VPS

Use HTTPS or SSH Git access.

```bash
cd /opt
sudo -u balancechecker git clone https://github.com/<your-account>/balance-checker-pro.git
cd /opt/balance-checker-pro
sudo -u balancechecker npm install
```

## Phase 4: Production Environment File

Copy the template and edit it:

```bash
sudo -u balancechecker cp /opt/balance-checker-pro/deploy/env/.env.production.example /opt/balance-checker-pro/.env
sudo -u balancechecker nano /opt/balance-checker-pro/.env
sudo chmod 600 /opt/balance-checker-pro/.env
```

Recommended production values:

```env
PORT=3000
NODE_ENV=production
SESSION_SECRET=<long-random-secret>
DB_PATH=/var/lib/balance-checker-pro/app.db
ENCRYPTION_KEY=<long-random-secret>
WORKER_ENABLED=true
WORKER_POLL_MS=3000
ADMIN_IP_ALLOWLIST=
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=<strong-password>
```

Notes:

- `SESSION_SECRET` and `ENCRYPTION_KEY` should be long random values.
- Leave `ADMIN_IP_ALLOWLIST` empty if your IP changes often.
- Set `WORKER_ENABLED=true` because batch processing runs in the same app process.

## Phase 5: Database Bootstrap

Run migrations and create the admin account:

```bash
cd /opt/balance-checker-pro
sudo -u balancechecker npm run db:migrate
sudo -u balancechecker npm run admin:bootstrap -- admin <strong-password>
```

## Phase 6: Install systemd Service

Copy the service template:

```bash
sudo cp /opt/balance-checker-pro/deploy/systemd/balance-checker-pro.service /etc/systemd/system/balance-checker-pro.service
sudo systemctl daemon-reload
sudo systemctl enable balance-checker-pro
sudo systemctl start balance-checker-pro
```

Check status:

```bash
sudo systemctl status balance-checker-pro
sudo journalctl -u balance-checker-pro -n 100 --no-pager
```

## Phase 7: Configure Nginx

Copy the site config and edit the domain:

```bash
sudo cp /opt/balance-checker-pro/deploy/nginx/balance-checker-pro.conf /etc/nginx/sites-available/balance-checker-pro
sudo nano /etc/nginx/sites-available/balance-checker-pro
```

Replace:

- `your-domain.example.com` with your real domain

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/balance-checker-pro /etc/nginx/sites-enabled/balance-checker-pro
sudo nginx -t
sudo systemctl reload nginx
```

## Phase 8: Enable HTTPS

After DNS points to the VPS:

```bash
sudo certbot --nginx -d your-domain.example.com
```

Verify auto-renew:

```bash
sudo systemctl status certbot.timer
```

## Phase 9: Smoke Test Production

Run these checks:

```bash
curl http://127.0.0.1:3000/health
curl https://your-domain.example.com/health
```

Then verify in browser:

- `/`
- `/check`
- `/admin/login`
- `/admin/proxies`
- `/admin/batches`

Manual production checks:

1. Create one proxy.
2. Test that proxy.
3. Run one single check.
4. Create one small batch.
5. Open batch details.
6. Export CSV.

## Daily Update Workflow

This is the default update path after you change code on Windows.

### On Windows

```powershell
cd D:\Projects\Code\balance-checker-pro
git status
git add .
git commit -m "Describe the change"
git push origin main
```

### On VPS

```bash
cd /opt/balance-checker-pro
sudo -u balancechecker git pull origin main
sudo -u balancechecker npm install
sudo -u balancechecker npm run db:migrate
sudo systemctl restart balance-checker-pro
sudo systemctl status balance-checker-pro
sudo journalctl -u balance-checker-pro -n 100 --no-pager
```

If dependencies did not change, `npm install` is still safe and keeps the workflow simple.

## Safe Update Sequence

Use this order every time:

1. Commit and push from Windows.
2. Pull on VPS.
3. Install dependencies.
4. Run migrations.
5. Restart systemd service.
6. Check journal logs.
7. Check `/health`.
8. Open the affected page in browser.

## Rollback Strategy

If a release is broken:

```bash
cd /opt/balance-checker-pro
git log --oneline -n 5
sudo -u balancechecker git checkout <last-good-commit>
sudo -u balancechecker npm install
sudo -u balancechecker npm run db:migrate
sudo systemctl restart balance-checker-pro
```

Do not use destructive Git commands unless you know exactly why.

## SQLite Backup

Manual backup:

```bash
sudo bash /opt/balance-checker-pro/deploy/scripts/backup-db.sh
```

Optional cron entry:

```bash
sudo crontab -e
```

Add:

```cron
0 3 * * * /bin/bash /opt/balance-checker-pro/deploy/scripts/backup-db.sh
```

This keeps seven days of database copies by default.
If `sqlite3` is installed, the script uses SQLite's native `.backup` command.

## Recommended Production Rules

- Keep the GitHub repository private.
- Do not commit `.env` or SQLite database files.
- Test locally before pushing.
- Run migrations on VPS after every schema change.
- Use the same Node.js major version locally and on VPS.
- Keep batch concurrency low on the current VPS size.

## Minimal Operations Checklist

For each release:

1. `git push origin main`
2. `git pull origin main`
3. `npm install`
4. `npm run db:migrate`
5. `systemctl restart balance-checker-pro`
6. `journalctl -u balance-checker-pro -n 100`
7. `curl https://your-domain.example.com/health`
