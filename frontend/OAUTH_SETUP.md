# Social authentication setup

The frontend uses the Cognito Hosted UI authorization-code flow with PKCE for Google and Discord login/account creation. Provider secrets are server-side only and must never be committed or exposed through `VITE_*` variables.

## Frontend configuration

```dotenv
VITE_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
VITE_APP_URL=https://<frontend-origin>
VITE_COGNITO_REGION=<region>
VITE_COGNITO_USER_POOL_ID=<pool-id>
VITE_COGNITO_CLIENT_ID=<public-app-client-id>
VITE_COGNITO_DOMAIN=<cognito-domain>
VITE_GOOGLE_ENABLED=true
VITE_DISCORD_ENABLED=true
```

Cognito must allow `${VITE_APP_URL}/auth/callback` as a callback URL. The application initiates Hosted UI authorization with PKCE and validates the original browser state before exchanging Cognito's code.

## Google

Register both redirect URIs with the Google OAuth web client:

```text
https://<cognito-domain>/oauth2/idpresponse
https://<frontend-origin>/account/settings
```

The first serves Cognito Hosted UI sign-in/signup. The second is `GoogleOAuthRedirectUri` for authenticated Account Settings linking. Supply `GoogleOAuthClientId` and `GoogleOAuthClientSecret` through deployment parameters. Cognito maps the provider's verified identity into the user pool.

## Discord login and signup

Discord exposes OAuth 2.0 but not the OpenID Connect discovery, JWKS, ID-token, and userinfo contract required by Cognito. This project therefore includes a minimal OIDC bridge in `backend/src/handlers/discordOidc.js`.

### Redirects

Register this Discord application redirect:

```text
https://<frontend-origin>/account/settings
```

The route serves two purposes, distinguished by cryptographically random state prefixes:

- `discord.*`: authenticated Account Settings connection callbacks;
- `oidc.*`: signed-out Discord login/signup handoffs to the public bridge callback.

The OIDC bridge ultimately returns to Cognito at:

```text
https://<cognito-domain>/oauth2/idpresponse
```

Cognito then returns the browser to:

```text
https://<frontend-origin>/auth/callback
```

### Bridge endpoints

The issuer is `${ApiUrl}/oidc/discord` and exposes:

- `GET /.well-known/openid-configuration`
- `GET /jwks.json`
- `GET /authorize`
- `POST /callback`
- `POST /token`
- `GET /userinfo`

All other application API routes remain protected by the Cognito authorizer.

### Deployment parameters

Supply these values through a protected deployment mechanism, never source control:

- `DiscordOAuthClientId`
- `DiscordOAuthClientSecret`
- `DiscordOAuthRedirectUri`
- `DiscordOIDCClientId` (a random public OIDC identifier shared by Cognito and the bridge)
- `DiscordOIDCClientSecret` (a separate random bridge secret)
- `DiscordOIDCPrivateKeyBase64` (a base64-encoded PKCS8 RSA private key)
- `DiscordOIDCKeyId`

The stack derives `DiscordOIDCIssuerUrl` from its API Gateway ID, region, stage, and `/oidc/discord` path; operators do not supply the issuer manually.

The bridge runtime is fully configured when all Discord OAuth, OIDC client, redirect, and signing-key values are present. Cognito advertises Discord only when those values are complete **and** `EnableDiscordCognito=true`.

Deploying a fresh environment is a two-phase operation:

1. Deploy with all bridge values supplied and `EnableDiscordCognito=false`; verify discovery and JWKS.
2. Deploy with the same values and `EnableDiscordCognito=true` to create the Cognito provider and advertise Discord to the app client.

### Security properties

- OIDC state, authorization codes, and access tokens are 32-byte random values.
- Only SHA-256 hashes are stored in the TTL-backed transaction table.
- State and authorization codes are atomically consumed once.
- Cognito client ID, client secret, redirect URI, response type, and scopes are validated.
- Provider link and disconnect actions require a recent Cognito `auth_time`; stale sessions must sign in again.
- Discord access/refresh tokens are never persisted.
- A verified Discord email is required.
- ID tokens are signed with RS256 and published through JWKS.
- Cognito state and nonce are preserved end-to-end.
- Provider and signing secrets are `NoEcho` deployment parameters and server-side Lambda environment values.

The first successful Discord Hosted UI flow creates the federated Cognito user; later flows sign in to it. Local Cognito users can connect Discord in Account Settings, which links the Discord subject to the local destination user. A primary Discord identity cannot be disconnected and does not expose local password-change controls.

## Local callback

The template allows `http://localhost:3000/auth/callback`. A local Discord bridge test also requires a Discord redirect registered for the local Account Settings handoff and a matching `FrontendUrl`; do not reuse production bridge secrets in local environments.


## Google Calendar synchronization

Google sign-in/account linking and Google Calendar authorization are separate capabilities. Cognito continues to request only `openid profile email`. Calendar scope is requested only when a Google-linked user explicitly selects **Enable auto-sync** in Account Settings.

The Calendar OAuth web client must allow:

```text
https://<frontend-origin>/account/settings
```

Enable the Google Calendar API for that Google Cloud project. Supply these protected SAM parameters:

- `EnableGoogleCalendarSync=true`
- `GoogleCalendarOAuthClientId`
- `GoogleCalendarOAuthClientSecret`
- `GoogleCalendarOAuthRedirectUri`
- `GoogleCalendarEncryptionKeyBase64` — exactly 32 cryptographically random bytes encoded as canonical base64
- `GoogleCalendarPreviousEncryptionKeyBase64` — normally empty; during rotation retain the former key here until all credentials are reauthorized or migrated
- `GoogleCalendarRevokeOnDisable` — keep `false` when the Google project is also used for sign-in; set `true` only for a dedicated Calendar project because Google revocation can remove project-wide grants

Generate encryption values outside the repository and pass them only through the protected deployment channel. Never put them in `.env`, frontend variables, source control, command logs, or deployment archives. Rotate in two deployments: first move the old current key to `GoogleCalendarPreviousEncryptionKeyBase64` while installing the new current key; clear the previous key only after credentials have been reauthorized or migrated. If neither retained key can authenticate a cleanup credential, the backend enters `cleanup_reauthorization_required` rather than retrying forever.

### Browser login storage

The frontend defaults to a session-only Cognito login. An explicit cookie-style prompt and the login form can opt a user into **Remember this browser** on a personal device:

- `session` keeps one namespaced Cognito token bundle in `sessionStorage`; closing the browser session removes it.
- `persistent` keeps that bundle in `localStorage`, allowing Cognito refresh-token restoration after a browser restart.
- Changing the preference migrates the complete token bundle and removes the copy in the other store. Sign-out clears both stores and legacy token keys.
- OAuth state, PKCE verifier, return path, and the per-flow storage choice remain namespaced in `sessionStorage` and are never made persistent.
- No advertising or tracking cookies are introduced. This SPA storage is not equivalent to an `HttpOnly` session cookie; any same-origin JavaScript can read `localStorage`, so persistent login should not be enabled on shared devices and XSS controls remain essential.

The preference is available again in Account Settings. If persistent browser storage is blocked or full, the client falls back to session-only behavior rather than duplicating or losing a valid session.



This AWS Academy stack uses the externally supplied `LabRoleArn`. Before every Calendar deployment, validate its documented DynamoDB, stream, SQS, Cognito, and CloudWatch Logs contract without printing secrets:

```powershell
.\backend\scripts\validate-calendar-role.ps1 -RoleArn <lab-role-arn> -AccountId <account-id> -Region us-east-1 -Environment prod
```

Deployment must stop if any simulator result is not `allowed`. The Calendar connection table is retained on stack deletion/replacement and has point-in-time recovery enabled because it contains the only cleanup tombstones.

### Consent and credential lifecycle

- Authorization uses a separate `calendar.*` state, a user/purpose-bound SHA-256 state hash, a 10-minute expiry, and atomic one-time consumption.
- The flow requests `calendar.events` with `access_type=offline`, explicit consent, and incremental authorization.
- The callback requires recent Cognito authentication, a linked Google identity, the same verified email and Google subject, the exact Calendar scope, and a refresh credential.
- Refresh credentials are encrypted with AES-256-GCM using a fresh 96-bit IV and user/purpose/version AAD before storage in the isolated Calendar connections table.
- Access tokens exist only in Lambda memory and are never returned to the browser or persisted.
- Read APIs return only safe status fields; the credential table is never serialized as an account profile.

### Event ownership and automatic updates

- Google Calendar is the default manual calendar action; ICS and Outlook remain available.
- Event IDs are deterministic SHA-256-derived Google-compatible identifiers scoped to environment, user, and task.
- Private extended properties mark the owning application, user hash, and task ID. Existing events are updated or deleted only after ownership verification.
- DynamoDB Streams deliver task create/update/delete changes to the Calendar worker. Per-item stream ordering, sequence-number partial-batch retries, and an encrypted terminal-failure queue prevent transient or exhausted failures from being silently lost.
- A one-minute scheduled reconciliation scans a bounded raw connection-table page, selects at most one active user, and advances one task/event item. Per-user failures are logged and isolated while the scheduler cursor advances so later users are not starved; cursor-persistence and other invocation-level failures still reject for Lambda asynchronous retry/failure handling.
- Consent callbacks, manual sync, and disable return `202 Accepted` after durable state changes. Provider reconciliation runs in the worker, keeping authenticated API requests below integration timeout budgets.
- Disabling sync first removes app-managed events in bounded pages. Credentials remain encrypted in `disable_pending` state if cleanup is incomplete. If Google authorization or a retained decryption key is unavailable, a `cleanup_reauthorization_required` tombstone keeps Google unlink blocked until the user reauthorizes only to finish removal.
- Google identity unlink atomically marks a non-primary link `unlinking`, invalidates pending identity OAuth state, and proves the Calendar row is absent in the same DynamoDB transaction. Calendar credential activation uses a conflicting transaction conditioned on the same active link, closing callback/unlink races.

Deployments are false-by-default: incomplete Calendar parameters or `EnableGoogleCalendarSync=false` keep the consent control unavailable. No Calendar permission is added to normal Google login/signup.
