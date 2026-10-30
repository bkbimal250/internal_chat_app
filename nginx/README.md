This directory is reserved for a future Nginx reverse proxy configuration.
Phase 1 uses the API bound to localhost:3001. No proxy or TLS certificates are
required. A future proxy should share the internal network with api, forward to
api:3001, and have its own ingress network. Configure trusted proxy addresses in
Fastify when introducing that deployment; do not trust arbitrary forwarded headers.
