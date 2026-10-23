/**
 * File: config-controller.ts
 * Description: Public settings the browser needs before it can sign in.
 * Author: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import { Request, Response } from 'express';

import { keycloakSettings } from '@/config/keycloak';
import { controller, get } from '@/controllers/decorators';

/**
 * The frontend is static files, so it cannot read the environment. It asks
 * here instead, which keeps the realm and client in one place (Infisical in
 * k8s) and the same image good for every environment.
 *
 * Only what any browser sees during sign-in anyway — a public client's address,
 * realm and id. Never a secret.
 */
@controller('')
export default class ConfigController {
  @get('/auth-config')
  async authConfig(_req: Request, res: Response) {
    const { url, realm, clientId, idpHint } = keycloakSettings();
    res.setHeader('Cache-Control', 'no-store');
    return res.send({ url, realm, clientId, idpHint });
  }
}
