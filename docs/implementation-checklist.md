# Implementation Checklist

## Current State

Completed:

- project bootstrap with Express + EJS
- SQLite initialization and migrations
- admin login with session auth
- proxy management
- batch upload and job creation
- internal batch worker foundation

## Next Steps

### 1. Verify worker against a real proxy

- test one valid API key on one known-good server
- confirm job moves `queued -> running -> completed`
- confirm `check_results` is populated
- confirm proxy stats update correctly

### 2. Add batch detail page

- route: `/admin/batches/:id`
- show all items, not only preview
- show result values per key
- show error code and error message

### 3. Add manual controls for batch jobs

- pause job
- resume job
- cancel pending items
- retry failed items

### 4. Add CSV export

- export all items for a batch
- include:
- masked key
- status
- selected proxy
- balance
- usage
- limit
- error message

### 5. Add single check page using selected server

- public page for one key
- user must choose server explicitly
- no auto routing
- display response time and selected proxy

### 6. Improve proxy test

- optional test mode for OpenAI-compatible billing endpoints
- distinguish:
- reachable
- auth failed
- billing endpoints unsupported

### 7. Add system settings UI

- edit:
- check timeout
- global concurrency
- per-proxy concurrency
- retry count
- cooldown threshold

### 8. Add check logs page

- filter by date
- filter by proxy
- filter by status
- inspect batch item result

### 9. Security hardening

- CSRF protection on admin forms
- TOTP 2FA
- stronger session secret enforcement
- optional admin IP allowlist

### 10. Production deployment

- create `.env` for production
- create systemd service
- configure Nginx reverse proxy
- enable HTTPS with Certbot
- configure backups for SQLite
- define update workflow with `git pull` + restart

## Deployment Sequence

Recommended order:

1. finish worker verification locally
2. push repo to private GitHub
3. clone to VPS
4. configure production `.env`
5. run migrations and bootstrap admin
6. configure systemd
7. configure Nginx + SSL
8. smoke test on VPS
9. document update procedure
