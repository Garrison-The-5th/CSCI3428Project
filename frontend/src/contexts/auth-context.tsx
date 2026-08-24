/**
 * File: auth-context.tsx
 * Description: Auth context for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';

import { keycloak } from '@/utils/keycloak';
import { logger } from '@/utils/logger';

export interface KeycloakUser {
  email?: string;
  name?: string;
  username?: string;
  sub?: string;
}

interface AuthContextType {
  authenticated: boolean;
  loading: boolean;
  user: KeycloakUser | null;
  token: string | null;
  login: () => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
  /** May author learning content: admin or contributor. */
  isAuthor: boolean;
  keycloak: typeof keycloak;
}

/**
 * A role may be mapped on the client or on the realm in Keycloak; either counts.
 * The backend applies the same rule in authMiddleware.ts, so what the UI shows
 * always matches what the API will accept.
 */
const hasEitherRole = (role: string) =>
  keycloak.hasResourceRole(role) || keycloak.hasRealmRole(role);

/**
 * Whether the signed-in user holds the admin role, in either place Keycloak
 * can put it — realm-level or on this client. Checking only one of the two has
 * been the cause of "my admin cannot see the admin tabs" more than once.
 */
export const isAdminUser = () => hasEitherRole('admin');

/** Contributors have the same authoring rights as admins over courses and quizzes. */
export const isAuthorUser = () => isAdminUser() || hasEitherRole('contributor');

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<KeycloakUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    keycloak
      .init({
        onLoad: 'check-sso',
        checkLoginIframe: false,
      })
      .then((auth) => {
        setAuthenticated(auth);

        if (auth) {
          /*
           * The decoded token is deliberately never logged.
           *
           * `console.log('Token parsed:', keycloak.tokenParsed)` used to run
           * here on every sign-in, in production as well as locally, printing
           * every claim — roles, subject, expiry — into the browser console.
           * That is a security disclosure under §3.10.3 and logging of
           * sensitive data under §3.4.1. Only the fact of a sign-in is
           * recorded now, and only in development.
           */
          logger.debug('Keycloak authenticated');

          setToken(keycloak.token || null);
          const userData = {
            email: keycloak.tokenParsed?.email,
            name: keycloak.tokenParsed?.name,
            username: keycloak.tokenParsed?.preferred_username,
            sub: keycloak.tokenParsed?.sub,
          };
          setUser(userData);

          // Setup Keycloak's built-in token refresh handler
          keycloak.onTokenExpired = () => {
            logger.debug('token expired, refreshing');
            keycloak
              .updateToken(30)
              .then((refreshed) => {
                if (refreshed) setToken(keycloak.token || null);
              })
              .catch(() => {
                logger.warn('failed to refresh token, signing out');
                keycloak.logout();
              });
          };
        }

        setLoading(false);
      })
      .catch((error) => {
        logger.error('Keycloak init error:', error);
        setLoading(false);
        setAuthenticated(false);
      });
  }, []);

  const login = () => {
    keycloak.login();
  };

  const logout = () => {
    keycloak.logout();
  };

  /**
   * Client or realm mapping counts, matching hasEitherRole above and the rule the
   * backend applies in authMiddleware. Checking only the realm — as this used to —
   * would deny someone whose role is mapped on the client, and the API would then
   * accept the very request the UI had just hidden.
   */
  const hasRole = (role: string): boolean => hasEitherRole(role);

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        loading,
        user,
        token,
        login,
        logout,
        hasRole,
        isAdmin: authenticated && isAdminUser(),
        isAuthor: authenticated && isAuthorUser(),
        keycloak,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
