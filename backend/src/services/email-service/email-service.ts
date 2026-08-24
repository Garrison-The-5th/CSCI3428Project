/**
 * File: email-service.ts
 * Description: Outbound email through the Gmail API, with redaction and safe headers.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { google } from 'googleapis';

import { logger } from '@/config/logger';

type GmailApiConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
};

type BroadcastEmailRequest = {
  recipients: Array<{ email: string; name: string | null }>;
  subject: string;
  message: string;
};

type BroadcastEmailResult = {
  sentCount: number;
  recipientCount: number;
};

/** How an assignment email turned out, so the caller can record or report it. */
type Delivery = {
  sent: boolean;
  /** Why it did not go out — shown to the author, so keep it plain. */
  reason?: string;
};

/**
 * Who the learner should see the message as coming from.
 *
 * The person who set the work, not a shared mailbox: a reply then lands with
 * whoever can actually answer it. Gmail only honours a From address the
 * authenticated account is allowed to send as, so Reply-To is set to the same
 * address — that part always works, and a reply reaches the right person even
 * when the From falls back to the configured sender.
 */
type Sender = {
  email: string;
  name?: string | null;
};

type AssignmentEmailRequest = {
  to: string;
  type: 'PLATFORM' | 'LINK';
  /** Title of the course or quiz being handed over. */
  title: string;
  kind: 'course' | 'quiz';
  /** Only ever put in the message body for a LINK assignment. */
  token: string;
  dueDate: Date | null;
  sender?: Sender | null;
  /** A repeat of a message already sent, so the subject says so. */
  resend?: boolean;
};

/** One section or quiz that has appeared in a course since someone finished it. */
export type NewContentItem = {
  kind: 'section' | 'quiz';
  /** "2.3" for a section, or the number of the section a quiz sits in. */
  number: string;
  title: string;
  /** The module it landed in, e.g. "2. Working safely". */
  module: string;
};

type NewContentEmailRequest = {
  to: string;
  courseId: string;
  courseTitle: string;
  items: NewContentItem[];
  sender?: Sender | null;
};

/** True when there is enough configuration to actually send anything. */
function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GMAIL_API_CONFIG);
}

/**
 * Replaces any assignment link in a message with a masked form.
 *
 * `https://host/a/8Kf3...` becomes `https://host/a/[REDACTED]`. Applied to the
 * whole body rather than to a known field, because the token is embedded in
 * prose and a future template change could easily move it.
 */
export function redactTokens(text: string): string {
  return text.replace(/(\/a\/)[A-Za-z0-9_-]{16,}/g, '$1[REDACTED]');
}

/**
 * Masks the local part of an address for logging: `ada@example.com` becomes
 * `a***@example.com`. Enough to correlate entries during an incident without
 * writing a full mailing list into the log (§3.4.1, §3.5.3).
 */
export function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || !local) return '[REDACTED]';
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Where the app lives, for building links that land on the right host. Falls
 * back to the dev frontend so a local run still produces a clickable URL.
 */
function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function parseConfig(): GmailApiConfig {
  const raw = process.env.GOOGLE_GMAIL_API_CONFIG;

  if (!raw) {
    throw new Error(
      'GOOGLE_GMAIL_API_CONFIG is not set. Add the Google Gmail API credentials JSON to ' +
        'enable sending email.',
    );
  }

  const parsed = JSON.parse(raw) as Partial<GmailApiConfig>;

  if (!parsed.clientId || !parsed.clientSecret || !parsed.refreshToken || !parsed.senderEmail) {
    throw new Error(
      'GOOGLE_GMAIL_API_CONFIG must contain clientId, clientSecret, refreshToken, and senderEmail.',
    );
  }

  return {
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    refreshToken: parsed.refreshToken,
    senderEmail: parsed.senderEmail,
  };
}

/**
 * A display name safe to put in a header. Anything that could start a new header
 * line is dropped, so a name out of the database cannot inject one.
 */
function headerSafe(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/["\\]/g, '')
    .trim();
}

/** `"Ada Lovelace" <ada@example.com>`, or the bare address when there is no name. */
function addressHeader(email: string, name?: string | null): string {
  const safeName = name ? headerSafe(name) : '';
  return safeName ? `"${safeName}" <${headerSafe(email)}>` : headerSafe(email);
}

function encodeEmail({
  from,
  to,
  subject,
  body,
  replyTo,
}: {
  from: string;
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${headerSafe(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ];

  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** "— sent by Ada Lovelace (ada@example.com)", when we know who assigned it. */
function signature(sender?: Sender | null): string {
  if (!sender?.email) return '';
  return `\n\n--\nSent by ${sender.name ? `${sender.name} (${sender.email})` : sender.email}`;
}

/** The subject and body for each of the two kinds of assignment. */
function composeAssignmentEmail({
  type,
  title,
  kind,
  token,
  dueDate,
  sender,
  resend,
}: AssignmentEmailRequest): { subject: string; body: string } {
  const due = dueDate ? `\n\nIt is due by ${dueDate.toLocaleDateString('en-GB')}.` : '';
  const base = appBaseUrl();
  // Same message either way; the prefix stops a resend reading as a second
  // enrolment to someone who already has the first mail in their inbox.
  const prefix = resend ? 'Reminder: ' : '';

  if (type === 'PLATFORM') {
    return {
      subject: `${prefix}You have been enrolled in ${title}`,
      body:
        `You have been enrolled in the ${kind} "${title}".${due}\n\n` +
        `Sign in to get started:\n${base}/login\n\n` +
        `You will find it on your Learning page once you are signed in.` +
        signature(sender),
    };
  }

  return {
    subject: `${prefix}Your ${kind}: ${title}`,
    body:
      `You have been given access to the ${kind} "${title}".${due}\n\n` +
      `Open it here — no sign-in needed:\n${base}/a/${token}\n\n` +
      `This link is personal to you. Please do not forward it: anyone who has it ` +
      `can work through the ${kind} as you.` +
      signature(sender),
  };
}

/**
 * The "there is more to do" message.
 *
 * Names the module and the sections rather than saying "this course changed",
 * because someone who has already finished a course needs to know what is left
 * for them, not that an edit happened. Items are grouped under their module
 * heading in the order the course reads.
 */
function composeNewContentEmail({ courseId, courseTitle, items, sender }: NewContentEmailRequest): {
  subject: string;
  body: string;
} {
  const byModule = new Map<string, NewContentItem[]>();
  for (const item of items) {
    byModule.set(item.module, [...(byModule.get(item.module) ?? []), item]);
  }

  const outline = [...byModule.entries()]
    .map(
      ([module, entries]) =>
        `${module}\n` +
        entries
          .map(
            (entry) => `  - ${entry.kind === 'quiz' ? 'Quiz: ' : ''}${entry.number} ${entry.title}`,
          )
          .join('\n'),
    )
    .join('\n\n');

  const count = items.length;

  return {
    subject: `New content in ${courseTitle}`,
    body:
      `"${courseTitle}" has gained ${count} new item${count === 1 ? '' : 's'} since you ` +
      `finished it:\n\n${outline}\n\n` +
      `Pick up where it leaves off:\n${appBaseUrl()}/learning/${courseId}` +
      signature(sender),
  };
}

export default class EmailService {
  /**
   * Tells someone what they have been assigned.
   *
   * Never throws. Assigning has already succeeded by the time this runs, and a
   * missing mail credential or a Gmail outage must not undo it — the failure
   * comes back as `sent: false` with a reason the author can act on. With no
   * credentials configured the message is logged instead, so the whole flow can
   * be exercised locally before any mailbox is wired up.
   */
  static async sendAssignmentEmail(request: AssignmentEmailRequest): Promise<Delivery> {
    const { subject, body } = composeAssignmentEmail(request);
    return EmailService.deliver({
      to: request.to,
      subject,
      body,
      sender: request.sender,
      label: 'assignment email',
      failurePrefix: 'The assignment was saved but the email failed',
    });
  }

  /**
   * Tells someone a course they had finished has gained content.
   *
   * Never throws, for the same reason as the assignment mail: this is triggered
   * by an author adding a section, and their edit must land whether or not the
   * mail does.
   */
  static async sendNewContentEmail(request: NewContentEmailRequest): Promise<Delivery> {
    if (request.items.length === 0) return { sent: false, reason: 'Nothing new to report.' };

    const { subject, body } = composeNewContentEmail(request);
    return EmailService.deliver({
      to: request.to,
      subject,
      body,
      sender: request.sender,
      label: 'new content email',
      failurePrefix: 'The update was saved but the email failed',
    });
  }

  /**
   * Sends one message, or logs it when there are no credentials. The whole point
   * of logging rather than throwing is that the assignment and notification
   * flows can be exercised end to end locally before any mailbox is wired up.
   */
  private static async deliver({
    to,
    subject,
    body,
    sender,
    label,
    failurePrefix,
  }: {
    to: string;
    subject: string;
    body: string;
    sender?: Sender | null;
    label: string;
    failurePrefix: string;
  }): Promise<Delivery> {
    if (!isConfigured()) {
      /**
       * Logged so the flow can be exercised before a mailbox is wired up — but
       * with the assignment link masked.
       *
       * The token in that URL *is* the credential: anyone holding it works
       * through the training as the recipient. Writing it to the log put a
       * live credential into whatever aggregates logs, where it outlives the
       * session and is readable by anyone with log access. TTG Technology
       * Standards §3.4.1 forbids exactly this.
       *
       * Developers who need the real link take it from the Copy link button on
       * the assignment roster, which is the same place an author gets it.
       */
      logger.info(
        {
          label,
          to: redactEmail(to),
          from: sender?.email ? redactEmail(sender.email) : undefined,
          subject,
          body: redactTokens(body),
        },
        'email not sent: GOOGLE_GMAIL_API_CONFIG is unset',
      );
      return { sent: false, reason: 'Email is not configured, so nothing was sent.' };
    }

    try {
      await EmailService.send({ to, subject, body, sender });
      return { sent: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ err: error, to: redactEmail(to) }, 'failed to send email');
      return { sent: false, reason: `${failurePrefix}: ${reason}` };
    }
  }

  /**
   * One message through the Gmail API. Throws if it does not go out.
   *
   * `sender` is the person the learner should be answering. Gmail will only put
   * their address in From if the authenticated account is allowed to send as it
   * (a verified send-as alias or a delegated mailbox) and silently substitutes
   * the account's own otherwise — so Reply-To carries the same address, and that
   * one is always honoured.
   */
  static async send({
    to,
    subject,
    body,
    sender,
  }: {
    to: string;
    subject: string;
    body: string;
    sender?: Sender | null;
  }) {
    const config = parseConfig();
    const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
    oauth2Client.setCredentials({ refresh_token: config.refreshToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodeEmail({
          from: sender?.email
            ? addressHeader(sender.email, sender.name)
            : addressHeader(config.senderEmail),
          to,
          subject,
          body,
          ...(sender?.email ? { replyTo: addressHeader(sender.email, sender.name) } : {}),
        }),
      },
    });
  }

  static async sendBroadcastEmail({
    recipients,
    subject,
    message,
  }: BroadcastEmailRequest): Promise<BroadcastEmailResult> {
    const config = parseConfig();
    const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);

    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });

    const gmail = google.gmail({
      version: 'v1',
      auth: oauth2Client,
    });

    const sendResults = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const raw = encodeEmail({
          from: config.senderEmail,
          to: recipient.email,
          subject,
          body: message,
        });

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw,
          },
        });
      }),
    );

    const sentCount = sendResults.filter((result) => result.status === 'fulfilled').length;

    if (sentCount === 0 && recipients.length > 0) {
      const rejection = sendResults.find((result) => result.status === 'rejected');
      throw new Error(
        rejection && rejection.status === 'rejected' && rejection.reason instanceof Error
          ? rejection.reason.message
          : 'Failed to send broadcast email',
      );
    }

    return {
      sentCount,
      recipientCount: recipients.length,
    };
  }
}
