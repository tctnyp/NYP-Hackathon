# Munera

> **Branch:** `dev` — active development source with Smart AI planning.

Munera is a responsive academic workload manager for deadlines, assignments, modules, progress, reminders, and study planning.

## Development feature set

- Task creation, editing, filtering, progress tracking, and deadline management
- Gemini 3.1 Pro Preview Smart AI planning with explicit task-context consent and ordered rate-limit key failover
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
- Optional AWS Cognito native MFA for password-primary accounts, with authenticator-app TOTP and deployment-gated email OTP
- Account Settings for profile, appearance, password, MFA, and provider connections
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

Private reminders are addressed directly to one user's profile email through SES rather than broadcast through SNS. The configured sender is `noreply@munera.com` for both Cognito transactional mail and task reminders. A legacy SNS topic may remain for infrastructure compatibility, but it is not the private notification transport. SES requires `noreply@munera.com` or the `munera.com` domain to be a verified source identity in the deployment account and region; while the account is in the SES sandbox, recipients must also be verified. The externally supplied LabRole must permit `ses:SendEmail` and `textract:AnalyzeDocument` in addition to the application's existing service actions.

Operational credentials, account identifiers, identity ARNs, and secrets are intentionally not published. Provider and OIDC signing secrets remain in protected deployment parameters; see [`frontend/OAUTH_SETUP.md`](frontend/OAUTH_SETUP.md) for the non-secret Google and Discord Cognito configuration, Calendar two-phase key rotation, redirect contract, and mandatory execution-role permission preflight.

**Deployment update safety:** every SAM deployment must preserve or explicitly resupply all Google, Discord, OIDC, Calendar, and native-email-MFA parameter values. Omitting the protected `NoEcho` overrides or allowing other integration parameters to fall back to empty defaults, which disables provider linking, removes the Cognito IdPs from the app client, and makes Calendar report `Setup required` even when an older stored connection still appears linked. Calendar may reuse `GoogleOAuthClientId` and `GoogleOAuthClientSecret`; the dedicated Calendar client parameters are optional overrides, but `EnableGoogleCalendarSync=true`, a matching Calendar redirect URI, and a 32-byte encryption key remain required.

## Native multi-factor authentication

The Cognito user pool uses `MfaConfiguration: OPTIONAL` so existing users are not locked out during rollout. Password-primary local users can enroll a standards-compatible authenticator app (including Google Authenticator) from Account Settings. Cognito issues and verifies the TOTP secret, and the application keeps that secret only in the active setup screen. During sign-in, the browser does not persist ID, access, or refresh tokens until Cognito accepts the native `SOFTWARE_TOKEN_MFA` or `EMAIL_OTP` challenge.

Google and Discord federated sign-ins are different: Cognito delegates their complete authentication to the identity provider and cannot impose a Cognito second factor afterward. Those users must configure MFA with Google or Discord. Linking Google or Discord to an account is not treated as MFA, and a post-token UI prompt would not protect the Cognito-authorized API.

Authenticator-app TOTP is always available to local users. Native email OTP is off by default and is enabled only when both `EnableNativeEmailMfa=true` and a verified SES identity ARN is supplied through `CognitoEmailSourceArn`; this selects Cognito `DEVELOPER` email delivery and requires the Cognito Essentials tier configured by the template. Do not enable email OTP until SES configuration is verified. Cognito cannot send password-recovery codes to the same email while that email is the user's MFA method, so the environment must have a documented administrator-assisted or alternate recovery path first.

For the safe default deployment, use:

```text
EnableNativeEmailMfa=false
```

## Smart AI configuration

Smart AI is an authenticated, suggestion-only study planner backed by the Gemini `generateContent` REST API. The browser sends requests only to `POST /smart-assistant`; API keys remain in Lambda environment variables populated from the `NoEcho` SAM parameters `GeminiApiKey1`, `GeminiApiKey2`, and `GeminiApiKey3`. Supply the three values at deployment time rather than adding them to frontend variables, source files, or committed SAM configuration.

The backend uses `gemini-3.1-pro-preview` by default (configurable through `GeminiModel`). It tries key 1 first and advances to key 2 and then key 3 only when Gemini returns HTTP 429 or `RESOURCE_EXHAUSTED`. Authentication, permission, malformed-request, network, and other upstream errors do not rotate keys. If all configured keys are rate limited, the API returns a retryable 429 without disclosing any key or upstream payload.

Students explicitly choose whether to include current task context. When enabled, only bounded incomplete-task summaries (title, module, deadline, status, priority, time estimate, and progress) are sent to Gemini; descriptions, account details, IDs, and completed tasks are excluded. Smart AI cannot mutate application data.

Example deployment parameters (use protected CI/CD secrets or an interactive deployment prompt for the values):

```text
GeminiApiKey1=<primary secret>
GeminiApiKey2=<second secret>
GeminiApiKey3=<third secret>
GeminiModel=gemini-3.1-pro-preview
```

The development backend target is the `academic-task-manager-dev` CloudFormation stack in `us-east-1`. Validate and build from `backend/`, then deploy with short-lived AWS credentials and the protected parameter values above. Verify CloudFormation completion, confirm the unsigned `/smart-assistant` request is rejected by Cognito, and use an authenticated request for the end-to-end Gemini smoke test. GitHub workflows validate and package frontend builds but do not publish hosting automatically.

Because credentials were shared in chat, rotate them if the conversation or terminal history is accessible to anyone who should not have API access.

## Branch policy

- `dev` contains active and experimental planning/recommendation work.
- `main` contains the approved final production surface, including bounded document extraction but no autonomous recommendation or task-creation pipeline.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki), especially [AWS Service Integrations](https://github.com/tctnyp/NYP-Hackathon/wiki/AWS-Service-Integrations), for architecture, service data flow, failure behavior, privacy/cost boundaries, and source references.

## License

Licensed under the repository's [LICENSE](LICENSE).
