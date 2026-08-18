# Academic Tasks

> **Branch:** `main` — approved final production source.

Academic Tasks is a responsive academic workload manager for deadlines, assignments, modules, progress, reminders, and study planning.

## Production feature set

- Task creation, editing, filtering, progress tracking, and deadline management
- Module organization and dashboard summaries
- User-reviewed task-field suggestions from a single-page JPEG, PNG, PDF, or TIFF uploaded temporarily to private Amazon S3 and analyzed through protected Amazon Textract
- Resized profile photos and custom backgrounds in owner-scoped private S3 storage with short-lived signed access URLs
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

The regional API Gateway REST API uses a Cognito authorizer for protected application routes. Browser-selected files have an absolute ceiling of 100 MiB minus one byte, with stricter purpose limits: resized profile derivatives up to 1 MiB, resized backgrounds up to 5 MiB, and assignment imports up to 4 MiB. The browser obtains a five-minute checksum-bound presigned POST for an exact owner-hashed key; S3 policy conditions bind content type, SHA-256 checksum, owner/purpose metadata, AES256 encryption, and content length. The bucket blocks public access and signed GET URLs are short-lived.

`POST /task-extractions` accepts only an owner-scoped temporary S3 key for a single-page JPEG, PNG, PDF, or TIFF, invokes synchronous Textract `AnalyzeDocument` with `FORMS`, and returns deterministic suggestions for explicit review/apply. The temporary object is deleted after processing or failure, with a one-day S3 lifecycle as a final cleanup backstop. Profile and background objects are promoted to durable owner-scoped keys; only those keys—not signed URLs—are persisted.

Private reminders are addressed directly to one user's profile email through SES rather than broadcast through SNS. A legacy SNS topic may remain for infrastructure compatibility, but it is not the private notification transport. SES requires a verified source identity and, while the account is in the SES sandbox, compliant verified recipients. The externally supplied LabRole must permit `ses:SendEmail` and `textract:AnalyzeDocument` in addition to the application's existing service actions.

Operational credentials, account identifiers, identity ARNs, and secrets are intentionally not published. Provider and OIDC signing secrets remain in protected deployment parameters; see [`frontend/OAUTH_SETUP.md`](frontend/OAUTH_SETUP.md) for the non-secret Google and Discord Cognito configuration, Calendar two-phase key rotation, redirect contract, and mandatory execution-role permission preflight.

## Branch policy

- `dev` contains active and experimental planning/recommendation work.
- `main` contains the approved final production surface, including bounded document extraction but no autonomous recommendation or task-creation pipeline.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki), especially [AWS Service Integrations](https://github.com/tctnyp/NYP-Hackathon/wiki/AWS-Service-Integrations), for architecture, service data flow, failure behavior, privacy/cost boundaries, and source references.

## License

Licensed under the repository's [LICENSE](LICENSE).
