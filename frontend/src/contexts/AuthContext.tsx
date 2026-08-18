import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { cognitoAuth, decodeJWT, tokenStorage } from '../services/cognitoAuth';

export interface CognitoUser {
  sub: string;
  email: string;
  username: string;
  groups?: string[];
  [key: string]: any;
}

interface AuthContextType {
  user: CognitoUser | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, email: string) => Promise<void>;
  confirmSignUp: (username: string, code: string) => Promise<void>;
  resendConfirmationCode: (username: string) => Promise<void>;
  signOut: () => Promise<void>;
  forgotPassword: (username: string) => Promise<void>;
  confirmForgotPassword: (username: string, code: string, newPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateUserAttributes: (attributes: Array<{ Name: string; Value: string }>) => Promise<void>;
  refreshSession: () => Promise<void>;
  loadSessionFromStorage: () => void;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<CognitoUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract user from token
  const extractUserFromToken = (idToken: string): CognitoUser | null => {
    const decoded = decodeJWT(idToken);
    if (!decoded) return null;

    const cognitoUsername = decoded['cognito:username'] || decoded.username || decoded.email;
    const isGoogleUser = typeof cognitoUsername === 'string' && cognitoUsername.toLowerCase().startsWith('google_');
    const fallbackDisplayName = decoded.name || decoded.email?.split('@')[0];
    const displayUsername = decoded.preferred_username
      || (isGoogleUser ? fallbackDisplayName : cognitoUsername)
      || fallbackDisplayName
      || 'User';

    return {
      ...decoded,
      sub: decoded.sub,
      email: decoded.email,
      username: displayUsername,
      groups: decoded['cognito:groups'] || [],
    };
  };

  // Check for existing session
  useEffect(() => {
    const checkSession = async () => {
      try {
        const idToken = tokenStorage.getIdToken();
        if (!idToken) {
          setLoading(false);
          return;
        }

        // Check if token is expired
        if (tokenStorage.isTokenExpired()) {
          try {
            await cognitoAuth.refreshTokens();
            const newIdToken = tokenStorage.getIdToken();
            if (newIdToken) {
              setUser(extractUserFromToken(newIdToken));
            }
          } catch (e) {
            // Refresh failed, clear tokens
            tokenStorage.clearTokens();
            setUser(null);
          }
        } else {
          setUser(extractUserFromToken(idToken));
        }
      } catch (error) {
        console.error('Session check failed:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const signIn = async (username: string, password: string) => {
    const result = await cognitoAuth.signIn(username, password);

    // Check if it's a challenge response
    if ('ChallengeName' in result) {
      throw new Error(`Challenge required: ${result.ChallengeName}`);
    }

    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      setUser(extractUserFromToken(idToken));
    }
  };

  const signUp = async (username: string, password: string, email: string) => {
    await cognitoAuth.signUp(username, password, email);
  };

  const confirmSignUp = async (username: string, code: string) => {
    await cognitoAuth.confirmSignUp(username, code);
  };

  const resendConfirmationCode = async (username: string) => {
    await cognitoAuth.resendConfirmationCode(username);
  };

  const signOut = async () => {
    await cognitoAuth.signOut();
    setUser(null);
  };

  const forgotPassword = async (username: string) => {
    await cognitoAuth.forgotPassword(username);
  };

  const confirmForgotPassword = async (username: string, code: string, newPassword: string) => {
    await cognitoAuth.confirmForgotPassword(username, code, newPassword);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await cognitoAuth.changePassword(currentPassword, newPassword);
  };

  const updateUserAttributes = async (attributes: Array<{ Name: string; Value: string }>) => {
    await cognitoAuth.updateUserAttributes(attributes);
  };

  const refreshSession = async () => {
    await cognitoAuth.refreshTokens();
    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      setUser(extractUserFromToken(idToken));
    }
  };

  const loadSessionFromStorage = () => {
    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      setUser(extractUserFromToken(idToken));
    }
  };

  const isAdmin = (): boolean => {
    return user?.['cognito:username'] === 'admin' && user?.groups?.includes('Admins') === true;
  };

  const value: AuthContextType = {
    user,
    loading,
    signIn,
    signUp,
    confirmSignUp,
    resendConfirmationCode,
    signOut,
    forgotPassword,
    confirmForgotPassword,
    changePassword,
    updateUserAttributes,
    refreshSession,
    loadSessionFromStorage,
    isAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;
