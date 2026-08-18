# Academic Tasks

> **Branch:** `dev` — active feature development and validation.

Academic Tasks is a responsive academic workload manager for deadlines, assignments, modules, progress, reminders, and study planning.

## Dev feature set

- Task creation, editing, filtering, progress tracking, and deadline management
- Module organization and dashboard summaries
- Calendar agenda with phone/ICS, Google Calendar, and Microsoft Outlook exports
- Installable Progressive Web App with offline app-shell support
- Android-style bottom navigation and safe-area-aware mobile layout
- Light, dark, and system themes
- Solid colors, gradient presets, custom gradients, and local image backgrounds
- Cognito authentication and administrator controls
- Scheduled reminder processing
- Experimental planning endpoints retained for evaluation on `dev`

## Source map

```text
frontend/src/components/   User interface and navigation
frontend/src/contexts/     Authentication, theme, and PWA state
frontend/src/services/     API, authentication, and calendar integrations
frontend/public/           Manifest, service worker, and app icons
backend/src/handlers/      Lambda request handlers
backend/src/utils/         Shared data and response helpers
backend/template.yaml      Serverless application resources
database/                  Reference schemas and sample data
```

## Branch policy

- `dev` contains active and experimental work.
- `main` contains the approved final production surface and excludes experimental planning endpoints.

Operational installation, deployment, credentials, and hosting procedures are intentionally not published in this repository.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki) for architecture, feature behavior, data flow, security boundaries, and branch policy.

## License

Licensed under the repository's [LICENSE](LICENSE).
