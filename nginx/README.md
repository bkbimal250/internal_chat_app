Nginx now ships inside the frontend image (`frontend/nginx.conf`) and terminates
only internal HTTP on port 8080. Public HTTPS/WSS is handled by Caddy
(`deploy/Caddyfile`) on ports 80 and 443.

Do not publish PostgreSQL or LocalStack ports. The API trusts `X-Forwarded-*`
only when `TRUST_PROXY=1`.
