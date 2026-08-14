# Cognito Authentication Implementation

## Overview

This backend has been migrated from API-key-only authentication to Amazon Cognito User Pool JWT authentication with comprehensive admin functionality.

## Architecture Changes

### Authentication
- **Cognito User Pool** with email aliases, auto-verified email, and strong password policy
- **Public App Client** supporting USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH, and OAuth 2.0 authorization code flow
- **API Gateway Default Authorizer**: All routes (except CORS) require valid Cognito JWT tokens
- **No API Key Required**: API key authentication has been fully removed

### User Management
- **PostConfirmation Trigger**: Automatically creates user profiles in DynamoDB when users confirm their accounts
- **First User Bootstrap**: The first confirmed user is automatically added to the Admins group using an atomic DynamoDB marker
- **Admin Group**: Cognito group for administrators with full system access

### Google OAuth (Optional)
- Conditionally enabled via CloudFormation parameters
- Requires `GoogleOAuthClientId` and `GoogleOAuthClientSecret` parameters
- Only included in supported providers when configured

### Admin Endpoints
Two new admin-only routes enforce Admins group membership server-side:
- **GET /admin/users**: List all Cognito users (with pagination)
- **PATCH /admin/users/{username}**: Enable/disable users or add/remove from Admins group

### Security Improvements
- **Claims-only identity**: `getUserId()` extracts user ID from JWT `sub` claim only (no fallback)
- **Token-based profile**: Account profile enriched with JWT claims (email, name)
- **Group-based authorization**: `isAdmin()` helper checks `cognito:groups` claim

## Stack Outputs

After deployment, the stack provides:
- `UserPoolId`: Cognito User Pool ID for frontend configuration
- `UserPoolClientId`: App Client ID for authentication flows
- `CognitoDomain`: Hosted UI domain URL
- `GoogleOAuthEnabled`: Boolean indicating if Google OAuth is configured
- `ApiUrl`: API Gateway endpoint URL

## CloudFormation Parameters

### Required
- `Environment`: dev/staging/prod (default: dev)
- `LabRoleArn`: IAM role for Lambda execution

### Optional (Google OAuth)
- `GoogleOAuthClientId`: Google OAuth 2.0 Client ID (default: empty)
- `GoogleOAuthClientSecret`: Google OAuth 2.0 Client Secret (NoEcho, default: empty)

## User Identity Flow

1. User signs up via Cognito (email + password or Google OAuth)
2. User confirms email (PostConfirmation trigger fires)
3. PostConfirmation Lambda:
   - Creates user profile in DynamoDB UsersTable
   - If first user, atomically grants Admins group membership
4. User signs in and receives JWT tokens
5. Frontend includes JWT in Authorization header
6. API Gateway validates JWT and passes claims to Lambda
7. Lambda extracts `sub`, `email`, `name`, and `cognito:groups` from claims

## Migration Notes

### Removed
- API Key resources (ApiKey, UsagePlan, UsagePlanKey)
- `ApiKeyRequired: true` from all API Gateway routes
- `DEFAULT_USER_ID` and `DEFAULT_USER_EMAIL` environment variables and fallback logic

### Preserved
- All existing DynamoDB tables and data
- All existing Lambda functions and routes
- Existing LabRole IAM role

## Discord Integration

Discord OAuth is **not** implemented as custom token issuance would be unsafe. To integrate Discord:
1. Use Amazon Cognito as the primary identity provider
2. Link Discord accounts via a custom profile field or separate OAuth flow
3. Store Discord user information in the user profile
4. Do NOT issue Cognito tokens based on Discord credentials without proper OIDC/SAML federation

## Deployment

```bash
# Build
sam build

# Deploy (without Google OAuth)
sam deploy --guided

# Deploy (with Google OAuth)
sam deploy --parameter-overrides \
  GoogleOAuthClientId=YOUR_CLIENT_ID \
  GoogleOAuthClientSecret=YOUR_CLIENT_SECRET
```

## Dependencies

Added to `backend/src/package.json`:
- `@aws-sdk/client-cognito-identity-provider@3.1098.0` (pinned)

## Files Modified

- `template.yaml`: Full Cognito infrastructure, admin functions, removed API key
- `src/utils/response.js`: Updated getUserId (claims-only), added getUserEmail, getUserName, isAdmin
- `src/handlers/account.js`: Updated to use JWT claims instead of DEFAULT_USER_EMAIL
- `src/package.json`: Added Cognito SDK dependency

## Files Created

- `src/handlers/postConfirmation.js`: PostConfirmation trigger for profile creation and first-admin grant
- `src/handlers/admin.js`: Admin endpoints for user management (listUsers, manageUser)

## Testing Admin Functions

```bash
# List users (requires Admins group)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://YOUR_API_URL/dev/admin/users

# Disable a user
curl -X PATCH -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"disable"}' \
  https://YOUR_API_URL/dev/admin/users/USERNAME

# Add user to Admins group
curl -X PATCH -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"addToGroup","group":"Admins"}' \
  https://YOUR_API_URL/dev/admin/users/USERNAME
```

## Security Considerations

- Strong password policy enforced (8+ chars, uppercase, lowercase, numbers, symbols)
- Email verification required before account activation
- Account recovery via verified email only
- PreventUserExistenceErrors enabled to prevent user enumeration
- Admin operations enforce group membership server-side (not client-side)
- First-user bootstrap uses atomic DynamoDB conditional write
- PostConfirmation trigger never blocks user confirmation on errors
