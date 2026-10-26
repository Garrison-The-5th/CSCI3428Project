/**
 * File: keycloak.ts
 * Description: The Keycloak realm and client this deployment uses, read once from the environment.
 * Author: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */

/**
 * The one place the realm and client are named.
 *
 * Everything — the backend's token checks, its admin API calls and the
 * browser's sign-in (through GET /auth-config) — reads them from here, so a
 * deployment moves to another realm by changing its environment (Infisical in
 * k8s) and nothing else. The image is the same in every environment.
 *
 * The app shares its realm with other applications, so everything it does is
 * scoped to its own client: its roles are client roles on KEYCLOAK_CLIENT_ID,
 * and it never grants or reads realm roles.
 */
export interface KeycloakSettings {
  /** Browser-facing Keycloak address, e.g. https://auth.ttgteams.com. */
  url: string;
  /**
   * Where the backend itself reaches Keycloak. Inside docker-compose that is the
   * service name, not the browser's localhost:4000 — hence KEYCLOAK_ADMIN_URL.
   */
  internalUrl: string;
  realm: string;
  /** The app's own client: whose roles count, and who the browser signs in as. */
  clientId: string;
  /** Every client whose tokens the API accepts — clientId first. */
  allowedClients: string[];
  /** What a token from this realm carries in `iss`. */
  issuer: string;
  /** Identity provider alias the "Continue with Google" button goes straight to. */
  idpHint: string;
}

export function keycloakSettings(): KeycloakSettings {
  const url = (process.env.KEYCLOAK_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const realm = process.env.KEYCLOAK_REALM ?? 'learningapp';
  const allowedClients = (process.env.KEYCLOAK_CLIENT_ID ?? 'learning-client')
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean);
  return {
    url,
    internalUrl: (process.env.KEYCLOAK_ADMIN_URL ?? url).replace(/\/+$/, ''),
    realm,
    clientId: allowedClients[0] ?? 'learning-client',
    allowedClients,
    issuer: `${url}/realms/${encodeURIComponent(realm)}`,
    idpHint: process.env.KEYCLOAK_IDP_HINT ?? 'google',
  };
}
