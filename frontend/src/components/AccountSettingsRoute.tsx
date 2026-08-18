import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AccountSettings from './AccountSettings';
import Layout from './Layout';
import ProtectedRoute from './ProtectedRoute';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function DiscordLoginHandoff() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const state = searchParams.get('state');
    const code = searchParams.get('code');
    const oauthError = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (!state?.startsWith('oidc.')) {
      setError('Invalid Discord login state. Start again from the sign-in page.');
      return;
    }
    if (!code && !oauthError) {
      setError('Discord did not return an authorization result.');
      return;
    }

    const complete = async () => {
      const response = await fetch(`${API_BASE_URL}/oidc/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          state,
          ...(code ? { code } : {}),
          ...(oauthError ? { error: oauthError } : {}),
          ...(errorDescription ? { error_description: errorDescription } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.redirect_url !== 'string') {
        throw new Error(data.error_description || 'Discord login could not be completed.');
      }
      window.location.replace(data.redirect_url);
    };

    void complete().catch((callbackError) => {
      setError(callbackError instanceof Error ? callbackError.message : 'Discord login could not be completed.');
    });
  }, [searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 to-blue-50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
          <AlertCircle className="mx-auto mb-4 text-red-600" size={48} />
          <h1 className="mb-3 text-2xl font-bold text-gray-900">Discord authentication failed</h1>
          <p className="mb-6 text-gray-600">{error}</p>
          <button type="button" className="btn-primary" onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 to-blue-50">
      <div className="text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent" />
        <p className="mt-4 text-lg text-gray-600">Completing Discord authentication…</p>
      </div>
    </div>
  );
}

function AccountSettingsRoute() {
  const [searchParams] = useSearchParams();
  const state = searchParams.get('state');

  if (state?.startsWith('oidc.')) return <DiscordLoginHandoff />;

  return (
    <ProtectedRoute>
      <Layout>
        <AccountSettings />
      </Layout>
    </ProtectedRoute>
  );
}

export default AccountSettingsRoute;
