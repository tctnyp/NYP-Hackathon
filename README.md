# Academic Tasks

> **Branch:** `main` — approved final production source.

Academic Tasks is a responsive academic workload manager for deadlines, assignments, modules, progress, reminders, and study planning.

## Production feature set

- Task creation, editing, filtering, progress tracking, and deadline management
- Module organization and dashboard summaries
- Calendar agenda with phone/ICS, Google Calendar, and Microsoft Outlook exports
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
backend/template.yaml      Production serverless resources
database/                  Reference schemas and sample data
```

## Branch policy

- `dev` contains active and experimental work, including AWS AI functionality.
- `main` contains the approved final production surface without experimental AI endpoints.

Operational credentials and secrets are intentionally not published. Provider and OIDC signing secrets must remain in protected deployment parameters; see [`frontend/OAUTH_SETUP.md`](frontend/OAUTH_SETUP.md) for the non-secret Google and Discord Cognito configuration and redirect contract.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki) for architecture, feature behavior, data flow, security boundaries, and branch policy.

## License

Licensed under the repository's [LICENSE](LICENSE).
