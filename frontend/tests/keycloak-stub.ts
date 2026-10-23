/**
 * File: keycloak-stub.ts
 * Description: Stand-in for keycloak-js under Jest.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */

/**
 * keycloak-js ships as ESM only, which Jest's CommonJS runtime cannot parse —
 * and a component test has no business talking to an identity provider anyway.
 * This gives the same surface the app uses, signed out by default. A test that
 * needs an authenticated session overrides these with jest.spyOn.
 */
class KeycloakStub {
  authenticated = false;
  token: string | undefined = undefined;
  tokenParsed: Record<string, unknown> | undefined = undefined;
  onTokenExpired: (() => void) | undefined = undefined;

  init = jest.fn().mockResolvedValue(false);
  login = jest.fn();
  logout = jest.fn();
  updateToken = jest.fn().mockResolvedValue(false);
  hasResourceRole = jest.fn().mockReturnValue(false);
}

export default KeycloakStub;
