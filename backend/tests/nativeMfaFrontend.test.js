const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.join(__dirname, '..', '..', 'frontend', 'src');
const cognitoAuth = fs.readFileSync(path.join(frontendRoot, 'services', 'cognitoAuth.ts'), 'utf8');
const authContext = fs.readFileSync(path.join(frontendRoot, 'contexts', 'AuthContext.tsx'), 'utf8');
const login = fs.readFileSync(path.join(frontendRoot, 'components', 'Login.tsx'), 'utf8');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Unable to locate ${start}..${end}`);
  return source.slice(startIndex, endIndex);
}

describe('frontend Cognito native MFA security contract', () => {
  test('responds to each native MFA challenge with Cognito canonical fields and session', () => {
    const block = between(cognitoAuth, 'async respondToMfaChallenge(', 'async getMfaStatus(');
    expect(block).toContain("'SOFTWARE_TOKEN_MFA_CODE'");
    expect(block).toContain("'EMAIL_OTP_CODE'");
    expect(block).toContain('USERNAME: canonicalUsername');
    expect(block).toContain('Session: challenge.Session');
    expect(block).toContain('ClientId: COGNITO_CLIENT_ID');
  });

  test('does not write tokens from either sign-in path before AuthenticationResult exists', () => {
    const passwordBlock = between(cognitoAuth, 'async signIn(', 'async respondToMfaChallenge(');
    const mfaBlock = between(cognitoAuth, 'async respondToMfaChallenge(', 'async getMfaStatus(');
    for (const block of [passwordBlock, mfaBlock]) {
      expect(block).toContain('if (data.AuthenticationResult)');
      expect(block).toContain('storeAuthenticationResult(data.AuthenticationResult');
      expect(block).not.toContain('tokenStorage.setTokens');
    }
    const persistenceBlock = between(cognitoAuth, 'function storeAuthenticationResult(', '// Decode JWT payload');
    expect(persistenceBlock).toContain('tokenStorage.setTokens(tokens, storagePreference)');
  });

  test('keeps the full Cognito session in AuthContext memory rather than browser storage', () => {
    expect(authContext).toContain('useState<PendingNativeMfaChallenge | null>(null)');
    expect(authContext).toContain('storagePreference: AuthStoragePreference');
    const completionBlock = between(authContext, 'const completeMfaSignIn', 'const cancelMfaSignIn');
    expect(completionBlock).toContain("/^\\d{6}$/");
    expect(completionBlock).not.toMatch(/localStorage|sessionStorage/);
  });

  test('bounds the login challenge to a six-digit one-time code and allows cancellation', () => {
    expect(login).toContain('autoComplete="one-time-code"');
    expect(login).toContain('pattern="[0-9]{6}"');
    expect(login).toContain('maxLength={6}');
    expect(login).toContain("replace(/\\D/g, '').slice(0, 6)");
    expect(login).toContain('cancelMfaSignIn()');
  });
});
