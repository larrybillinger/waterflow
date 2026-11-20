# Permissions and data policy

v0.1 single-user/local prototype. No user accounts or permissions. All scenarios are ephemeral in the running process, not saved to a database. Anyone possessing a live scenario ID can update it; therefore Docker binds 127.0.0.1 by default. Do not publish without authentication and rate limiting, reverse-proxy protections, per-user storage isolation, response caching policy and legal review of imagery terms. No tokens/secrets required for current sources. Users download JSON exports locally; no upload/import endpoint.

## Advanced Studio and tile proxy

Studio has no login or saved state. The image tile proxy restricts HTTPS hostnames and exact tile URL shapes; public deployments still need rate limiting and appropriate protections. The default compose binding remains localhost. No personal scenario data crosses between the engines.
