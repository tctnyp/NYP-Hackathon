'use strict';

const fs = require('node:fs');
const path = require('node:path');

const template = fs.readFileSync(path.join(__dirname, '..', 'template.yaml'), 'utf8');

describe('social and Calendar deployment configuration', () => {
  test('Calendar sync accepts either a dedicated Calendar client or the configured Google client', () => {
    expect(template).toContain('HasDedicatedGoogleCalendarOAuth: !And');
    expect(template).toContain('HasGoogleCalendarOAuth: !Or');
    expect(template).toContain('- !Condition HasDedicatedGoogleCalendarOAuth');
    expect(template).toContain('- !Condition HasGoogleOAuth');
    expect(template).toContain('- !Condition HasGoogleCalendarOAuth');
  });

  test('all Calendar Lambdas resolve client credentials through the dedicated-or-shared fallback', () => {
    const clientIdFallback = 'GOOGLE_CALENDAR_OAUTH_CLIENT_ID: !If [HasDedicatedGoogleCalendarOAuth, !Ref GoogleCalendarOAuthClientId, !Ref GoogleOAuthClientId]';
    const clientSecretFallback = 'GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: !If [HasDedicatedGoogleCalendarOAuth, !Ref GoogleCalendarOAuthClientSecret, !Ref GoogleOAuthClientSecret]';

    expect(template.split(clientIdFallback)).toHaveLength(4);
    expect(template.split(clientSecretFallback)).toHaveLength(3);
    expect(template).not.toContain('GOOGLE_CALENDAR_OAUTH_CLIENT_ID: !Ref GoogleCalendarOAuthClientId');
    expect(template).not.toContain('GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: !Ref GoogleCalendarOAuthClientSecret');
  });
});



describe('Cognito native MFA deployment configuration', () => {
  test('keeps MFA optional while always making software-token TOTP available', () => {
    expect(template).toContain('UserPoolTier: ESSENTIALS');
    expect(template).toContain('MfaConfiguration: OPTIONAL');
    expect(template).toMatch(/EnabledMfas:\r?\n\s+- SOFTWARE_TOKEN_MFA/);
  });

  test('does not enable email OTP unless both the explicit gate and SES sender exist', () => {
    expect(template).toMatch(/EnableNativeEmailMfa:\r?\n\s+Type: String\r?\n\s+Default: 'false'/);
    expect(template).toContain('HasNativeEmailMfa: !And');
    expect(template).toContain("- !Equals [!Ref EnableNativeEmailMfa, 'true']");
    expect(template).toContain('- !Condition HasCustomEmailSender');
    expect(template).toContain("- !If [HasNativeEmailMfa, EMAIL_OTP, !Ref 'AWS::NoValue']");
    expect(template).toContain("NATIVE_EMAIL_MFA_ENABLED: !If [HasNativeEmailMfa, 'true', 'false']");
  });

  test('only configures Cognito email authentication content when email OTP is enabled', () => {
    expect(template).toContain("EmailAuthenticationSubject: !If [HasNativeEmailMfa, Your Munera sign-in code, !Ref 'AWS::NoValue']");
    expect(template).toContain("EmailAuthenticationMessage: !If [HasNativeEmailMfa, 'Your Munera sign-in code is {####}.', !Ref 'AWS::NoValue']");
  });
});
