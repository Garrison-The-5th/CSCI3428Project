/**
 * File: auth-context.tsx
 * Description: Auth context for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import type Keycloak from 'keycloak-js';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';

import { getKeycloak } from '@/utils/keycloak';
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
  keycloak: Keycloak;
}

/**
 * Only roles on this app's own Keycloak client count — never realm roles. The
 * realm is shared with other applications, so a realm-wide `admin` means
 * nothing here. The backend applies the same rule in auth-middleware.ts, so
 * what the UI shows always matches what the API will accept.
 */
const hasClientRole = (role: string) => getKeycloak().hasResourceRole(role);

/** Whether the signed-in user holds the app's admin role. */
export const isAdminUser = () => hasClientRole('admin');

/** Contributors have the same authoring rights as admins over courses and quizzes. */
export const isAuthorUser = () => isAdminUser() || hasClientRole('contributor');

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Starts Keycloak, keeps the token fresh, and provides the signed-in user, their roles and
 * login/logout to the app.
 */
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const keycloak = getKeycloak();
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

  /** Sends the browser to the Keycloak sign-in page. */
  const login = () => {
    keycloak.login();
  };

  /** Signs out of Keycloak. */
  const logout = () => {
    keycloak.logout();
  };

  /** A role on this app's client, matching the rule the backend applies. */
  const hasRole = (role: string): boolean => hasClientRole(role);

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

/** The auth context. Throws if used outside AuthProvider. */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
