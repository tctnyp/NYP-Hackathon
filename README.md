# Academic Tasks

> **Branch:** `main` — approved final production source.

Academic Tasks is a responsive academic workload manager for deadlines, assignments, modules, progress, reminders, and study planning.

## Production feature set

- Task creation, editing, filtering, progress tracking, and deadline management
- Module organization and dashboard summaries
- User-reviewed task-field suggestions from a single-page JPEG, PNG, PDF, or TIFF through protected Amazon Textract analysis
- Google Calendar as the default calendar action, with phone/ICS and Microsoft Outlook fallbacks
- Explicit Google-linked Calendar auto-sync with encrypted server-side credentials and durable task updates
- Installable Progressive Web App with offline app-shell support
- Android-style bottom navigation and safe-area-aware mobile layout
- Light, dark, and system themes
- Solid colors, gradient presets, custom gradients, and local image backgrounds
- Cognito authentication with Google and Discord federation
- Account Settings for profile, appearance, password, and provider connections
- EventBridge deadline/reminder checks every 15 minutes with direct per-user Amazon SES email; separate Calendar reconciliation runs every minute

Experimental planning/recommendation routes, handlers, schemas, and frontend surfaces are intentionally excluded from `main` and remain isolated to `dev`. The production Textract route is a bounded extraction aid: documents are not stored, suggestions require user review, and no task is created automatically.

## Source map

```text
frontend/src/components/   User interface, task suggestion review, and navigation
frontend/src/contexts/     Authentication, theme, and PWA state
frontend/src/services/     API, authentication, extraction, and calendar integrations
frontend/public/           Manifest, service worker, and app icons
backend/src/handlers/      Production Lambda handlers, including reminders and extraction
backend/src/utils/         Shared data and response helpers
backend/scripts/           Deployment permission-contract preflight checks
backend/template.yaml      API, schedules, permissions, and serverless resources
database/                  Reference schemas and sample data
```

## Service boundaries

The regional API Gateway REST API uses a Cognito authorizer for protected application routes. `POST /task-extractions` accepts only a single-page JPEG, PNG, PDF, or TIFF up to 4 MiB, invokes synchronous Textract `AnalyzeDocument` with `FORMS`, and returns deterministic suggestions for explicit review/apply in the task form. It uses no S3 or document persistence.

Private reminders are addressed directly to one user's profile email through SES rather than broadcast through SNS. A legacy SNS topic may remain for infrastructure compatibility, but it is not the private notification transport. SES requires a verified source identity and, while the account is in the SES sandbox, compliant verified recipients. The externally supplied LabRole must permit `ses:SendEmail` and `textract:AnalyzeDocument` in addition to the application's existing service actions.

Operational credentials, account identifiers, identity ARNs, and secrets are intentionally not published. Provider and OIDC signing secrets remain in protected deployment parameters; see [`frontend/OAUTH_SETUP.md`](frontend/OAUTH_SETUP.md) for the non-secret Google and Discord Cognito configuration, Calendar two-phase key rotation, redirect contract, and mandatory execution-role permission preflight.

## Branch policy

- `dev` contains active and experimental planning/recommendation work.
- `main` contains the approved final production surface, including bounded document extraction but no autonomous recommendation or task-creation pipeline.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki), especially [AWS Service Integrations](https://github.com/tctnyp/NYP-Hackathon/wiki/AWS-Service-Integrations), for architecture, service data flow, failure behavior, privacy/cost boundaries, and source references.

## License

Licensed under the repository's [LICENSE](LICENSE).
