# Waterflow project agent rules

Read this file before making changes. Source code and documented decisions, not chat history, are the source of truth.

**Read order:** AGENTS.md, README.md, VERSION, CHANGELOG.md, planning/project-state.md, planning/decisions.md, planning/risks.md, planning/questions.md, docs/architecture.md, docs/permissions.md, docs/validation.md, active planning/sprints/sprint-###.

Architect plans goals, constraints, changes, risks and acceptance tests; builder implements the approved sprint. Before changes, summarize scope, exclusions, files affected, risks and tests. Do not invent persisted configuration, security rules or hydraulic accuracy claims. Record new decisions/risks/questions in planning, track the version, changelog and release notes. Use descriptive git commits and an isolated branch for meaningful features. Keep secrets in environment variables (never commit .env). Maintain deterministic numerical tests and cover upstream failure conditions.

UI rules: the map fills the viewport; clean, high-contrast professional HUD; avoid decorative borders, clutter and nonfunctional controls. Keyboard, focus, attribution and responsive layouts matter. Don't trade hydraulic accuracy for aesthetics; label unvalidated modeling clearly. No claim that 3D depiction or depth is authoritative. Don't treat a synthetic breach source as a real dam-failure estimate.

No authentication in v0.1; binds localhost by default. Public hosting requires rate limiting, access controls and proxy hardening. Scenario states are in-memory and transient. No external mutable API is invoked except fetching public elevation data.

## Studio integration

Classic lives in web/ and server/terrain.py; Claude's Advanced Studio lives in studio/. Read studio/AGENTS.md and studio/docs/hydraulics.md before changes there. Never silently combine numerical arrays or breach forcing. Only geography is carried between engines. Fictional terrain is opt-in and permanently labeled. Keep v0.3 test and validation limitations documented.
