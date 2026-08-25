/**
 * File: mailcheck.ts
 * Description: Mailcheck for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-24
 */
import 'dotenv/config';

import EmailService from '@/services/email-service/email-service';

(async () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log('EMAIL_USER / EMAIL_APP_PASSWORD are not set here');
    process.exit(0);
  }

  console.log('sender      :', user);
  console.log('appPassword :', `present (${pass.length} chars)`);
  console.log('smtp        :', process.env.SMTP_HOST || 'smtp.gmail.com');
  console.log('');

  const result = await EmailService.sendAssignmentEmail({
    to: user,
    type: 'PLATFORM',
    title: 'Credential check',
    kind: 'course',
    token: 'not-a-real-token',
    dueDate: null,
  });
  console.log('RESULT:', JSON.stringify(result));
})();
