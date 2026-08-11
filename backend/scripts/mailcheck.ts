/**
 * File: mailcheck.ts
 * Description: Mailcheck for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import 'dotenv/config';

import EmailService from '@/services/email-service/email-service';

(async () => {
  const raw = process.env.GOOGLE_GMAIL_API_CONFIG;
  if (!raw) {
    console.log('GOOGLE_GMAIL_API_CONFIG is not set here');
    process.exit(0);
  }

  const cfg = JSON.parse(raw);
  console.log('senderEmail :', cfg.senderEmail);
  console.log('clientId    :', String(cfg.clientId).slice(0, 18) + '…');
  console.log(
    'refreshToken:',
    cfg.refreshToken ? `present (${cfg.refreshToken.length} chars)` : 'MISSING',
  );
  console.log('');

  const result = await EmailService.sendAssignmentEmail({
    to: cfg.senderEmail,
    type: 'PLATFORM',
    title: 'Credential check',
    kind: 'course',
    token: 'not-a-real-token',
    dueDate: null,
  });
  console.log('RESULT:', JSON.stringify(result));
})();
