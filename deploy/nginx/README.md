# Host Nginx vhosts (manual install)

These files are for the existing Ubuntu Nginx, not Caddy and not the
container Nginx that serves the SPA files.

| File | Server name | Upstream |
| --- | --- | --- |
| `web.michat.in.conf` | `web.michat.in` | `127.0.0.1:3046` |
| `api.michat.in.conf` | `api.michat.in` | `127.0.0.1:3045` |

Neither file uses `default_server`. Do not copy them over other site configs.
Do not run `systemctl reload nginx` until `nginx -t` succeeds and you approve.

If you change `WEB_HOST_PORT` or `API_HOST_PORT` in `.env.production`, update
the `upstream` servers in these files to match.
