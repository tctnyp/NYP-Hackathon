# Academic Tasks

> **Branch:** `main` — approved final production source.

Academic Tasks is a responsive academic workload manager for deadlines, assignments, modules, progress, reminders, and study planning.

## Production feature set

- Task creation, editing, filtering, progress tracking, and deadline management
- Module organization and dashboard summaries
- Google Calendar as the default calendar action, with phone/ICS and Microsoft Outlook fallbacks
- Explicit Google-linked Calendar auto-sync with encrypted server-side credentials and durable task updates
- Installable Progressive Web App with offline app-shell support
- Android-style bottom navigation and safe-area-aware mobile layout
- Light, dark, and system themes
- Solid colors, gradient presets, custom gradients, and local image backgrounds
- Cognito authentication with Google and Discord federation
- Account Settings for profile, appearance, password, and provider connections
- Scheduled reminder processing and SNS notifications

Experimental planning and AWS AI routes, handlers, schemas, and frontend surfaces are intentionally excluded from `main` and remain isolated to `dev`.

## Source map

```text
frontend/src/components/   User interface and navigation
frontend/src/contexts/     Authentication, theme, and PWA state
frontend/src/services/     API, authentication, and calendar integrations
frontend/public/           Manifest, service worker, and app icons
backend/src/handlers/      Production Lambda handlers
backend/src/utils/         Shared data and response helpers
backend/scripts/           Deployment permission-contract preflight checks
backend/template.yaml      Production serverless resources
database/                  Reference schemas and sample data
```

## Branch policy

- `dev` contains active and experimental work, including AWS AI functionality.
- `main` contains the approved final production surface without experimental AI endpoints.

Operational credentials and secrets are intentionally not published. Provider and OIDC signing secrets must remain in protected deployment parameters; see [`frontend/OAUTH_SETUP.md`](frontend/OAUTH_SETUP.md) for the non-secret Google and Discord Cognito configuration, Calendar two-phase key rotation, redirect contract, and mandatory `backend/scripts/validate-calendar-role.ps1` preflight for the externally supplied AWS Academy role.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki) for architecture, feature behavior, data flow, security boundaries, and branch policy.

## License

Licensed under the repository's [LICENSE](LICENSE).
