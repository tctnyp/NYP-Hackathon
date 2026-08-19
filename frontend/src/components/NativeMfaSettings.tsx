import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import type { NativeMfaCapability } from '../services/api';
import { cognitoAuth, type NativeMfaStatus } from '../services/cognitoAuth';

interface NativeMfaSettingsProps {
  capability: NativeMfaCapability;
  email?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to update multi-factor authentication.';
}

export default function NativeMfaSettings({ capability, email }: NativeMfaSettingsProps) {
  const [status, setStatus] = useState<NativeMfaStatus>({ enabled: [], preferred: null });
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(capability.available);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refreshStatus = useCallback(async () => {
    if (!capability.available) return;
    const nextStatus = await cognitoAuth.getMfaStatus();
    setStatus(nextStatus);
  }, [capability.available]);

  useEffect(() => {
    let active = true;
    if (!capability.available) {
      setLoading(false);
      return () => { active = false; };
    }
    void refreshStatus()
      .catch((statusError) => { if (active) setError(errorMessage(statusError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [capability.available, refreshStatus]);

  if (capability.provider_managed) {
    const provider = capability.provider_managed === 'google' ? 'Google' : 'Discord';
    return (
      <section className="card" aria-labelledby="mfa-heading">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700"><ShieldCheck size={22} /></div>
          <div>
            <h2 id="mfa-heading" className="text-lg font-semibold">Multi-factor authentication</h2>
            <p className="mt-1 text-sm text-gray-600">This account signs in through {provider}. Cognito delegates the complete sign-in to {provider}, so configure MFA in your {provider} account security settings.</p>
            <p className="mt-2 text-xs text-gray-500">Linking another provider here does not make it a second authentication factor.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!capability.available) {
    return (
      <section className="card" aria-labelledby="mfa-heading">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600"><ShieldCheck size={22} /></div>
          <div><h2 id="mfa-heading" className="text-lg font-semibold">Multi-factor authentication</h2><p className="mt-1 text-sm text-gray-500">Native Cognito MFA is available only for password-based accounts.</p></div>
        </div>
      </section>
    );
  }

  const totpEnabled = status.enabled.includes('totp');
  const emailEnabled = status.enabled.includes('email');
  const setupUri = secret
    ? `otpauth://totp/Academic%20Tasks:${encodeURIComponent(email || 'account')}?secret=${secret}&issuer=Academic%20Tasks`
    : '';

  const beginTotpSetup = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      setSecret(await cognitoAuth.associateSoftwareToken());
      setCode('');
    } catch (setupError) {
      setError(errorMessage(setupError));
    } finally {
      setBusy(false);
    }
  };

  const verifyTotp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Enter the six-digit code from your authenticator app.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await cognitoAuth.verifySoftwareToken(code);
      await cognitoAuth.setMfaPreference({ totpEnabled: true, preferred: 'totp' });
      setSecret(''); setCode('');
      await refreshStatus();
      setMessage('Authenticator-app MFA is enabled and preferred.');
    } catch (verifyError) {
      setError(errorMessage(verifyError));
    } finally {
      setBusy(false);
    }
  };

  const updateTotp = async (enabled: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await cognitoAuth.setMfaPreference({
        totpEnabled: enabled,
        preferred: enabled ? 'totp' : (emailEnabled ? 'email' : null),
      });
      await refreshStatus();
      setMessage(enabled ? 'Authenticator-app MFA is preferred.' : 'Authenticator-app MFA is disabled. Cognito retains the enrolled secret.');
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  };

  const updateEmail = async (enabled: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await cognitoAuth.setMfaPreference({
        emailEnabled: enabled,
        preferred: enabled ? 'email' : (totpEnabled ? 'totp' : null),
      });
      await refreshStatus();
      setMessage(enabled ? 'Email OTP MFA is enabled and preferred.' : 'Email OTP MFA is disabled.');
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="mfa-heading">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700"><ShieldCheck size={22} /></div>
        <div><h2 id="mfa-heading" className="text-lg font-semibold">Multi-factor authentication</h2><p className="mt-1 text-sm text-gray-500">Secure this password-based account with AWS Cognito native MFA.</p></div>
      </div>

      {loading ? <p className="flex items-center gap-2 text-sm text-gray-600" role="status"><LoaderCircle className="animate-spin" size={17} /> Loading MFA status…</p> : (
        <div className="divide-y divide-gray-200">
          <div className="pb-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="flex gap-3"><KeyRound className="mt-0.5 shrink-0 text-gray-500" size={20} /><div><h3 className="font-semibold">Authenticator app</h3><p className="text-sm text-gray-500">Use Google Authenticator or another standards-compatible TOTP app.</p><p className="mt-1 text-xs font-medium text-gray-600">{totpEnabled ? `Enabled${status.preferred === 'totp' ? ' · preferred' : ''}` : 'Not enabled'}</p></div></div>
              {!secret && <button type="button" className={totpEnabled ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => void (totpEnabled ? updateTotp(false) : beginTotpSetup())}>{busy ? 'Working…' : totpEnabled ? 'Disable' : 'Set up'}</button>}
            </div>
            {totpEnabled && status.preferred !== 'totp' && <button type="button" className="mt-3 text-sm font-semibold text-primary-600" disabled={busy} onClick={() => void updateTotp(true)}>Make preferred</button>}
            {secret && (
              <form className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4" onSubmit={verifyTotp}>
                <p className="text-sm font-medium text-blue-950">Enter this secret manually in your authenticator app. It is held only in this setup screen.</p>
                <code className="block break-all rounded bg-white p-3 text-sm font-semibold tracking-wider text-gray-900" aria-label="Authenticator secret">{secret}</code>
                <details className="text-xs text-blue-900"><summary className="cursor-pointer font-medium">Show setup URI</summary><code className="mt-2 block break-all">{setupUri}</code></details>
                <label className="block text-sm font-medium">Six-digit code<input className="input-field mt-1 max-w-xs tracking-[0.3em]" value={code} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
                <div className="flex gap-2"><button className="btn-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and enable'}</button><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setSecret(''); setCode(''); setError(''); }}>Cancel</button></div>
              </form>
            )}
          </div>

          {capability.email_available && (
            <div className="pt-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="flex gap-3"><Mail className="mt-0.5 shrink-0 text-gray-500" size={20} /><div><h3 className="font-semibold">Email verification code</h3><p className="text-sm text-gray-500">Receive a Cognito one-time sign-in code at your verified email.</p><p className="mt-1 text-xs font-medium text-gray-600">{emailEnabled ? `Enabled${status.preferred === 'email' ? ' · preferred' : ''}` : 'Not enabled'}</p></div></div>
                <button type="button" className={emailEnabled ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => void updateEmail(!emailEnabled)}>{busy ? 'Working…' : emailEnabled ? 'Disable' : 'Enable'}</button>
              </div>
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">If email is your MFA method, Cognito cannot also send password-recovery codes to that same email. An administrator-assisted recovery path may be required.</p>
              {emailEnabled && status.preferred !== 'email' && <button type="button" className="mt-3 text-sm font-semibold text-primary-600" disabled={busy} onClick={() => void updateEmail(true)}>Make preferred</button>}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-4 text-sm font-medium text-red-600" role="alert">{error}</p>}
      {message && <p className="mt-4 text-sm font-medium text-green-700" role="status">{message}</p>}
    </section>
  );
}
