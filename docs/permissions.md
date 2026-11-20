# Permissions and data policy

v0.1 single-user/local prototype. No user accounts or permissions. All scenarios are ephemeral in the running process, not saved to a database. Anyone possessing a live scenario ID can update it; therefore Docker binds 127.0.0.1 by default. Do not publish without authentication and rate limiting, reverse-proxy protections, per-user storage isolation, response caching policy and legal review of imagery terms. No tokens/secrets required for current sources. Users download JSON exports locally; no upload/import endpoint.

## GPU Studio

The GPU Studio is a static browser application at /studio/ with no login, accounts, server write API or scenario persistence. It loads public tiles into the browser from external providers. The combined service is bound to localhost. Do not expose it publicly without authorization, abuse controls and an imagery licensing review. The Express standalone tile proxy is not part of the combined service, and no open URL proxy is introduced.
