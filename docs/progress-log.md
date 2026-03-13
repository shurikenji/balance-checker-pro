# Progress Log

## Locked Scope

- One admin only
- Batch check many keys
- Manual proxy selection only
- No auto server selection for admin or user
- Oracle VPS target: Ubuntu, 1 CPU, 1 GB RAM
- Stack: Express + SQLite + EJS + Nginx + systemd

## Milestones

### Completed

1. Project bootstrap
- Express app
- EJS views
- environment config
- health endpoint

2. SQLite foundation
- database bootstrap
- migrations
- base tables

3. Admin authentication
- login
- session auth
- bootstrap admin script
- dashboard shell

4. Proxy management
- create proxy
- edit proxy
- delete proxy
- test proxy reachability
- enable/disable proxy
- proxy stats
- proxy rate multiplier support

5. Batch intake
- upload TXT/CSV
- paste keys in textarea, one key per line
- validate keys
- store encrypted keys
- create jobs and items

6. Batch worker foundation
- background polling loop
- process queued jobs
- save check results
- update job progress

7. Public single-check page
- route `/check`
- explicit server selection required
- single key check through selected proxy
- single check logs stored in DB
- result applies selected proxy rate multiplier

8. Batch detail and result visibility
- add `/admin/batches/:id`
- show all items
- show per-item success/failure details

9. CSV export
- export batch items and results as CSV

10. Batch controls: pause, resume, cancel, retry failed
- pause queued or running jobs
- resume paused jobs
- cancel pending items
- retry failed items that still have encrypted keys

11. Check logs page
- combined single check and batch item logs
- filter by type, status, proxy, and limit

12. Settings UI
- edit timeout, concurrency, retry, and cooldown values from admin

13. Security hardening
- CSRF protection for admin forms
- admin login rate limiting
- optional admin IP allowlist

14. GitHub + VPS deployment workflow
- deployment guide for Windows -> GitHub -> Ubuntu VPS
- production `.env` template
- `systemd` service template
- `nginx` site template
- SQLite backup script

### Pending

## Notes

- This file should be updated whenever a milestone changes state.
- `docs/implementation-checklist.md` stays as the broader roadmap.
- This file is the live progress tracker during implementation.
