/**
 * File: central-profile-gateway.ts
 * Description: Calls to the central profile service — making sure a person who signs in has a profile there.
 * Author: rware <rware@ttgteams.com>
 * Date: 2026-11-10
 */

/**
 * The only place the backend talks to the central profile service.
 *
 * People sign up for the app through the shared Keycloak realm, so central has
 * never heard of a self sign-up until something tells it. `resolvePerson` does
 * that on a person's first sign-in here: central returns the profile if it
 * already has this Keycloak id, or creates one from the token's details.
 *
 * It signs in as a service account (client credentials) whose client holds
 * central's `person.write` role. Env:
 *   CENTRAL_PROFILE_URL            e.g. http://central-profile-backend-service.central-profile.svc
 *   CENTRAL_PROFILE_TOKEN_URL      https://auth.ttgteams.com/realms/central/protocol/openid-connect/token
 *   CENTRAL_PROFILE_CLIENT_ID
 *   CENTRAL_PROFILE_CLIENT_SECRET
 * Without them the call is skipped, which is what local development wants.
 */

/** What central needs to find or create a person. Exactly one of the two emails is sent. */
export interface PersonResolve {
  keycloak_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  work_email?: string;
}

/** Thrown for anything central refuses, with its status so callers can tell 409 from an outage. */
export class CentralProfileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface CentralProfileConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

/** How long a call to central may take before it is given up on. */
const TIMEOUT_MS = 10_000;

function config(): CentralProfileConfig | null {
  const read = (name: string) => process.env[name]?.trim() || null;
  const baseUrl = read('CENTRAL_PROFILE_URL');
  const tokenUrl = read('CENTRAL_PROFILE_TOKEN_URL');
  const clientId = read('CENTRAL_PROFILE_CLIENT_ID');
  const clientSecret = read('CENTRAL_PROFILE_CLIENT_SECRET');
  if (!baseUrl || !tokenUrl || !clientId || !clientSecret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), tokenUrl, clientId, clientSecret };
}

export default class CentralProfileGateway {
  private static cachedToken: { value: string; expiresAt: number } | null = null;

  /** Whether central is set up for this deployment. */
  static isConfigured(): boolean {
    return config() !== null;
  }

  /** Forgets the cached token. For tests, and after a credentials change. */
  static resetToken() {
    CentralProfileGateway.cachedToken = null;
  }

  /** A service-account token, reused until shortly before it expires. */
  private static async token(settings: CentralProfileConfig): Promise<string> {
    const cached = CentralProfileGateway.cachedToken;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const response = await fetch(settings.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !body.access_token) {
      throw new CentralProfileError(
        `Could not get a central profile token (${response.status})`,
        response.status,
      );
    }
    // Renewed 30 s early so a token never expires mid-request.
    CentralProfileGateway.cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 60) - 30, 0) * 1000,
    };
    return body.access_token;
  }

  /**
   * Finds the person with this Keycloak id in central, or creates them.
   * Returns false when central is not configured and nothing was sent.
   */
  static async resolvePerson(person: PersonResolve): Promise<boolean> {
    const settings = config();
    if (!settings) return false;

    const response = await fetch(`${settings.baseUrl}/persons/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await CentralProfileGateway.token(settings)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(person),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200: central already knew them. 201: just created.
    if (response.status !== 200 && response.status !== 201) {
      throw new CentralProfileError(
        `Central profile refused the sign-in (${response.status})`,
        response.status,
      );
    }
    return true;
  }
}
