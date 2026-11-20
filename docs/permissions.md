# Permissions

## Current model: there are none

Waterflow v0.1.0 has no accounts, no logins, no roles and no server-side state. Everything
runs in the browser. Anyone who can reach the page can use every feature, and nothing one
visitor does affects another.

This file exists because `AGENTS.md` requires it in the read order and because the absence
of a permissions model is itself a decision worth recording rather than leaving implicit.

## What that means in practice

| Concern | Position |
| --- | --- |
| Authentication | None. Not required, because there is nothing private to protect. |
| Authorisation | None. No roles, no admin area. |
| User data | None stored. No cookies, no local storage, no analytics, no telemetry. |
| Scenario data | Lives in the page. Closing the tab discards it. |
| Secrets | None. Every data source is public and keyless. There is no `.env` value that is sensitive in the current build. |
| Server | Optional, and serves static files plus a tile cache. It holds nothing about anyone. |

## The tile proxy

If `VITE_TILE_PROXY` is set, the bundled Node server proxies map tile requests and caches
them on disk.

It is an open proxy to the extent that it will fetch whatever URL it is handed, which is
the one thing in this project that needs care if it is ever exposed beyond a private
network. The current implementation restricts it to an allowlist of the hosts in
`src/data/sources.js`; that restriction is load-bearing and must not be removed to make a
new source work. Add the host to the allowlist instead.

The cache holds public map tiles only. There is nothing in it that is not already public.

## If this ever grows users

Open question Q-004 asks whether scenarios should be saveable, and one of the options is
server-side storage against a user. Taking that option means this file stops being a
statement that there is no permissions model and starts being a specification of one.
Nothing here should be treated as a design for that; it would need deciding properly,
written down here first, and only then built.

Until that happens, the Business Rule Protection section of `AGENTS.md` applies: do not
invent login behaviour, user roles or admin permissions. If a change seems to need them,
stop and raise it as an open question.
