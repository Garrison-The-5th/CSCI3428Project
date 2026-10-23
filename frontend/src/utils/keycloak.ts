/**
 * File: keycloak.ts
 * Description: The Keycloak client instance, configured at start-up from the backend.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import Keycloak from 'keycloak-js';

import { API_BASE_URL } from '@/utils/utils';

/** What GET /auth-config answers: the realm and client to sign in with. */
export interface AuthConfig {
  url: string;
  realm: string;
  clientId: string;
  /** Identity provider alias for the "Continue with Google" button. */
  idpHint: string;
}

/**
 * The configured client and its settings, set by `loadKeycloak()` — which
 * index.tsx awaits before rendering anything, so the getters below always find
 * them filled in.
 *
 * They come from the backend rather than from a file baked into the bundle, so
 * one image serves every environment and the realm is chosen by that
 * environment's settings (Infisical in k8s).
 */
let keycloak: Keycloak | null = null;
let authConfig: AuthConfig | null = null;

/** The Keycloak client. Throws if called before `loadKeycloak()` has finished. */
export function getKeycloak(): Keycloak {
  if (!keycloak) throw new Error('Keycloak is not loaded yet — see loadKeycloak()');
  return keycloak;
}

/** The sign-in settings from GET /auth-config. Throws if called before they are loaded. */
export function getAuthConfig(): AuthConfig {
  if (!authConfig) throw new Error('Sign-in settings are not loaded yet — see loadKeycloak()');
  return authConfig;
}

/** Fetches the sign-in settings and creates the Keycloak client from them. */
export async function loadKeycloak(): Promise<Keycloak> {
  const response = await fetch(`${API_BASE_URL}/auth-config`);
  if (!response.ok) {
    throw new Error(`Could not load sign-in settings (${response.status})`);
  }
  const settings = (await response.json()) as AuthConfig;
  authConfig = settings;
  keycloak = new Keycloak({
    url: settings.url,
    realm: settings.realm,
    clientId: settings.clientId,
  });
  return keycloak;
}
