import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SocialAuthButtons from './SocialAuthButtons';
import { AUTH_STORAGE_CHANGE_EVENT, tokenStorage } from '../services/authStorage';

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, nativeMfaChallenge, completeMfaSignIn, cancelMfaSignIn } = useAuth();
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberBrowser, setRememberBrowser] = useState(() => tokenStorage.getPreference() === 'persistent');

  useEffect(() => {
    const synchronize = () => setRememberBrowser(tokenStorage.getPreference() === 'persistent');
    window.addEventListener(AUTH_STORAGE_CHANGE_EVENT, synchronize);
    return () => window.removeEventListener(AUTH_STORAGE_CHANGE_EVENT, synchronize);
  }, []);

  const from = (location.state as any)?.from?.pathname || '/dashboard';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const preference = tokenStorage.setPreference(rememberBrowser ? 'persistent' : 'session');
      const challenge = await signIn(formData.username, formData.password, preference);
      if (!challenge) navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(mfaCode)) {
      setError('Enter the six-digit verification code.');
      return;
    }
    setLoading(true);
    try {
      await completeMfaSignIn(mfaCode);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'The verification code could not be accepted.');
    } finally {
      setLoading(false);
    }
  };

  const cancelMfa = () => {
    cancelMfaSignIn();
    setMfaCode('');
    setError('');
    setFormData((current) => ({ ...current, password: '' }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <img src="/icons/app-icon.svg" alt="" aria-hidden="true" width="80" height="80" className="mx-auto mb-4 h-20 w-20 rounded-3xl shadow-lg shadow-blue-600/20" />
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-primary-600">Academic Tasks</p>
            <h1 className="text-3xl font-bold text-gray-900">{nativeMfaChallenge ? 'Verify it’s you' : 'Welcome back'}</h1>
            <p className="text-gray-600 mt-2">
              {nativeMfaChallenge?.type === 'totp'
                ? 'Enter the code from your authenticator app.'
                : nativeMfaChallenge?.type === 'email'
                  ? `Enter the code Cognito sent${nativeMfaChallenge.destination ? ` to ${nativeMfaChallenge.destination}` : ' to your verified email'}.`
                  : 'Sign in to continue planning your work'}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3" role="alert">
              <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {nativeMfaChallenge ? (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <label htmlFor="mfa-code" className="block text-sm font-medium text-gray-700">
                Verification code
                <span className="relative mt-2 block">
                  <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 tracking-[0.35em] focus:border-transparent focus:ring-2 focus:ring-primary-500"
                    placeholder="000000"
                  />
                </span>
              </label>
              <button type="submit" disabled={loading || mfaCode.length !== 6} className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Verifying…' : 'Verify and sign in'}
              </button>
              <button type="button" disabled={loading} className="w-full py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50" onClick={cancelMfa}>
                Cancel and start over
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">Username or Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input id="username" type="text" required value={formData.username} onChange={(event) => setFormData({ ...formData, username: event.target.value })} className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="Enter your username" autoComplete="username" />
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input id="password" type="password" required value={formData.password} onChange={(event) => setFormData({ ...formData, password: event.target.value })} className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="Enter your password" autoComplete="current-password" />
                  </div>
                </div>
                <label className="flex items-start gap-3 text-sm text-gray-700">
                  <input type="checkbox" checked={rememberBrowser} disabled={loading} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" onChange={(event) => {
                    const applied = tokenStorage.setPreference(event.target.checked ? 'persistent' : 'session');
                    setRememberBrowser(applied === 'persistent');
                  }} />
                  <span><span className="font-medium">Keep me signed in on this device</span><span className="mt-0.5 block text-xs text-gray-500">Do not enable this on a shared or public device.</span></span>
                </label>
                <div className="flex items-center justify-between text-sm"><Link to="/forgot-password" className="text-primary-600 hover:text-primary-700 font-medium">Forgot password?</Link></div>
                <button type="submit" disabled={loading} className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{loading ? 'Signing in...' : 'Sign In'}</button>
              </form>
              <SocialAuthButtons mode="login" returnTo={from} onError={setError} storagePreference={rememberBrowser ? 'persistent' : 'session'} />
              <div className="mt-6 text-center text-sm text-gray-600">Don't have an account?{' '}<Link to="/register" className="text-primary-600 hover:text-primary-700 font-medium">Sign up</Link></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
