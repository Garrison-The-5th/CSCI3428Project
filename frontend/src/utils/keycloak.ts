/**
 * File: keycloak.ts
 * Description: The configured Keycloak client instance.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import Keycloak from 'keycloak-js';

import kcConfig from '../../../config/keycloak.json';

export const keycloak = new Keycloak({
  url: kcConfig['auth-server-url'],
  realm: kcConfig.realm,
  clientId: kcConfig.resource,
});
