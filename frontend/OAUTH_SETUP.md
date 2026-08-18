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
