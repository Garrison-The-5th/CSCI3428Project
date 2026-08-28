/**
 * File: email-service.ts
 * Description: Outbound email over SMTP (app-password auth), with redaction and safe headers.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-27
 */
import nodemailer from 'nodemailer';

import { appBaseUrl, configuredBaseUrl } from '@/config/app-url';
import { logger } from '@/config/logger';

/** Gmail's implicit-TLS submission port, and the host an app password belongs to. */
const DEFAULT_SMTP_HOST = 'smtp.gmail.com';
const DEFAULT_SMTP_PORT = 465;

/**
 * Fail fast rather than hang.
 *
 * Nodemailer's own defaults are minutes long, and a cluster that blocks outbound
 * 465 does not refuse the connection — it black-holes it. Without these, the
 * first assignment after a bad deploy holds an HTTP request open until the OS
 * gives up on the TCP handshake, and the author watches a spinner instead of
 * being told. Ten seconds is far longer than a working relay ever needs.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

type SmtpConfig = {
  /** The mailbox everything is sent as, e.g. noreply@ttgteams.com. */
  senderEmail: string;
  appPassword: string;
  host: string;
  port: number;
  /** Implicit TLS (465). Anything else negotiates STARTTLS instead. */
  secure: boolean;
};

type BroadcastEmailRequest = {
  recipients: Array<{ email: string; name: string | null }>;
  subject: string;
  message: string;
};

type BroadcastEmailResult = {
  sentCount: number;
  recipientCount: number;
  /** Set when nothing went out, so the caller can say why instead of "sent". */
  reason?: string;
};

/** How an assignment email turned out, so the caller can record or report it. */
type Delivery = {
  sent: boolean;
  /** Why it did not go out — shown to the author, so keep it plain. */
  reason?: string;
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
  /** A repeat of a message already sent, so the subject says so. */
  resend?: boolean;
  /**
   * The origin the request that triggered this arrived on, so the link lands on
   * the host the app is actually being served from. See `config/app-url.ts`;
   * `APP_BASE_URL` still overrides it, and omitting it is what a background job
   * with no request in scope does.
   */
  baseUrl?: string | null;
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
  /** The origin to build the link on — see `AssignmentEmailRequest.baseUrl`. */
  baseUrl?: string | null;
};

/**
 * Strips every space out of an app password.
 *
 * Google shows a 16-character app password as four groups of four — `abcd efgh
 * ijkl mnop` — and that is what gets copied. SMTP auth with the spaces left in
 * fails as a wrong password, which reads in the logs exactly like a revoked
 * credential. A Kubernetes Secret adds the other half of this problem: a value
 * base64-encoded with `echo` instead of `echo -n` carries a trailing newline
 * that no amount of staring at the manifest reveals. Both are stripped here so
 * a correct password entered in a reasonable way authenticates.
 */
export function normaliseAppPassword(raw: string): string {
  return raw.replace(/\s+/g, '');
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
 * Turns an SMTP failure into something an author can act on.
 *
 * Nodemailer puts the useful part in `code`, and the raw `message` is a server
 * banner — "535-5.7.8 Username and Password not accepted. Learn more at ..." —
 * which is both meaningless to whoever clicked Assign and more about our
 * infrastructure than they need. The raw error still goes to the log; this is
 * only what reaches the screen.
 */
export function describeSmtpFailure(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'EAUTH':
      return 'the mail account rejected the app password';
    case 'ETIMEDOUT':
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'EDNS':
      return 'the mail server could not be reached';
    case 'EENVELOPE':
      return 'the address was rejected';
    case 'EMESSAGE':
      return 'the message itself was rejected';
    default:
      return error instanceof Error && error.message ? error.message : 'unknown error';
  }
}

/**
 * The SMTP settings, or null when this deployment has no mailbox wired up.
 *
 * Null rather than a throw: sending is a side effect of assigning, and an
 * environment with no credentials is a normal state (every local checkout
 * starts there), not an error. Every value is trimmed — a Secret is a string
 * someone typed, and a stray newline in the host is as fatal as a wrong one.
 */
function readConfig(): SmtpConfig | null {
  const senderEmail = process.env.EMAIL_USER?.trim();
  const appPassword = process.env.EMAIL_APP_PASSWORD
    ? normaliseAppPassword(process.env.EMAIL_APP_PASSWORD)
    : '';

  if (!senderEmail || !appPassword) return null;

  const configuredPort = Number.parseInt(process.env.SMTP_PORT?.trim() ?? '', 10);
  const port =
    Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536
      ? configuredPort
      : DEFAULT_SMTP_PORT;

  return {
    senderEmail,
    appPassword,
    host: process.env.SMTP_HOST?.trim() || DEFAULT_SMTP_HOST,
    port,
    secure: port === 465,
  };
}

/**
 * One SMTP connection pool. Gmail app passwords authenticate a plain SMTP
 * session; the pool keeps a broadcast from opening a connection per recipient.
 * Every caller closes it when done.
 *
 * On any port but 465 the session starts in the clear and upgrades, so
 * `requireTLS` makes that upgrade mandatory: without it a relay that fails to
 * offer STARTTLS would get the app password in plaintext.
 */
function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    pool: true,
    auth: {
      user: config.senderEmail,
      pass: config.appPassword,
    },
    // `as const` keeps this a SecureVersion rather than widening to string,
    // which would drop createTransport onto its generic overload.
    tls: { minVersion: 'TLSv1.2' as const },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
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

/** The subject and body for each of the two kinds of assignment. */
function composeAssignmentEmail({
  type,
  title,
  kind,
  token,
  dueDate,
  resend,
  baseUrl,
}: AssignmentEmailRequest): { subject: string; body: string } {
  const due = dueDate ? `\n\nIt is due by ${dueDate.toLocaleDateString('en-GB')}.` : '';
  const base = appBaseUrl(baseUrl);
  // Same message either way; the prefix stops a resend reading as a second
  // enrolment to someone who already has the first mail in their inbox.
  const prefix = resend ? 'Reminder: ' : '';

  if (type === 'PLATFORM') {
    return {
      subject: `${prefix}You have been enrolled in ${title}`,
      body:
        `You have been enrolled in the ${kind} "${title}".${due}\n\n` +
        `Sign in to get started:\n${base}/login\n\n` +
        `You will find it on your Learning page once you are signed in.`,
    };
  }

  return {
    subject: `${prefix}Your ${kind}: ${title}`,
    body:
      `You have been given access to the ${kind} "${title}".${due}\n\n` +
      `Open it here — no sign-in needed:\n${base}/a/${token}\n\n` +
      `This link is personal to you. Please do not forward it: anyone who has it ` +
      `can work through the ${kind} as you.`,
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
function composeNewContentEmail({
  courseId,
  courseTitle,
  items,
  baseUrl,
}: NewContentEmailRequest): {
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
      `Pick up where it leaves off:\n${appBaseUrl(baseUrl)}/learning/${courseId}`,
  };
}

export default class EmailService {
  /**
   * Says at boot whether this deployment can send mail, and over what.
   *
   * Called once from startup. Email that quietly does nothing is the failure
   * this exists to prevent: with no credentials the app still assigns, still
   * reports success for everything except the notice, and nothing in the logs
   * volunteers why until somebody goes looking. One line at boot turns that into
   * a grep. It never throws and never blocks readiness — a mail relay being
   * unreachable is not a reason to fail a rollout.
   */
  static reportConfiguration(): void {
    const config = readConfig();

    if (!config) {
      logger.warn(
        'email disabled: EMAIL_USER and EMAIL_APP_PASSWORD are unset, so assignment ' +
          'and notification mail will be logged instead of sent',
      );
      return;
    }

    logger.info(
      {
        relay: `${config.host}:${config.port}`,
        secure: config.secure,
        as: redactEmail(config.senderEmail),
      },
      'email enabled',
    );

    if (process.env.NODE_ENV === 'production' && !configuredBaseUrl()) {
      logger.info(
        'APP_BASE_URL is unset: links in outgoing mail will use the host each request ' +
          'arrives on. Set it to pin them to one address.',
      );
    }

    // Deliberately not awaited. The answer lands in the log a moment after boot,
    // which is soon enough for the thing it is for — telling an operator that
    // the credentials in the Secret actually authenticate.
    void EmailService.verifyConnection().then((result) => {
      if (result.ok) {
        logger.info({ relay: `${config.host}:${config.port}` }, 'smtp ready');
        return;
      }
      logger.error(
        { relay: `${config.host}:${config.port}`, reason: result.reason },
        'smtp unavailable: mail will fail until this is fixed',
      );
    });
  }

  /**
   * Opens a session and authenticates, sending nothing.
   *
   * Used by the boot check, and safe to call from a console when someone is
   * asking whether a Secret is right — it proves the credential without putting
   * a test message in anyone's inbox.
   */
  static async verifyConnection(): Promise<{ ok: boolean; reason?: string }> {
    const config = readConfig();
    if (!config) return { ok: false, reason: 'Email is not configured.' };

    const transport = createTransport(config);

    try {
      await transport.verify();
      return { ok: true };
    } catch (error) {
      logger.error({ err: error }, 'smtp verification failed');
      return { ok: false, reason: describeSmtpFailure(error) };
    } finally {
      transport.close();
    }
  }

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
    label,
    failurePrefix,
  }: {
    to: string;
    subject: string;
    body: string;
    label: string;
    failurePrefix: string;
  }): Promise<Delivery> {
    const config = readConfig();

    if (!config) {
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
          subject,
          body: redactTokens(body),
        },
        'email not sent: EMAIL_USER / EMAIL_APP_PASSWORD are unset',
      );
      return { sent: false, reason: 'Email is not configured, so nothing was sent.' };
    }

    try {
      await EmailService.send({ to, subject, body }, config);
      return { sent: true };
    } catch (error) {
      const reason = describeSmtpFailure(error);
      logger.error(
        {
          err: error,
          to: redactEmail(to),
          label,
          relay: `${config.host}:${config.port}`,
        },
        'failed to send email',
      );
      return { sent: false, reason: `${failurePrefix}: ${reason}.` };
    }
  }

  /**
   * One message over SMTP. Throws if it does not go out.
   *
   * Everything goes out as the configured no-reply mailbox and nothing else:
   * SPF and DKIM only align for the account the app password belongs to, so the
   * From address could never have been the author's. It used to carry the
   * assigning author as the From display name and in Reply-To, which meant a
   * placeholder profile in the identity provider — a name of "test test", an
   * address of user@example.com — was what every learner saw and replied to.
   * The mailbox is the sender now, so no account's profile can leak into a
   * message or collect the replies.
   */
  static async send(
    { to, subject, body }: { to: string; subject: string; body: string },
    config: SmtpConfig | null = readConfig(),
  ) {
    if (!config) {
      throw new Error('EMAIL_USER and EMAIL_APP_PASSWORD must both be set to send email.');
    }

    const transport = createTransport(config);

    try {
      await transport.sendMail({
        from: headerSafe(config.senderEmail),
        to: headerSafe(to),
        subject: headerSafe(subject),
        text: body,
      });
    } finally {
      transport.close();
    }
  }

  /**
   * The same message to every subscriber, over one pooled connection.
   *
   * Returns rather than throws when there is nothing to send with: an admin who
   * has just written a newsletter needs to be told the mailbox is not
   * configured, and a 500 from the generic error handler tells them only that
   * something went wrong.
   */
  static async sendBroadcastEmail({
    recipients,
    subject,
    message,
  }: BroadcastEmailRequest): Promise<BroadcastEmailResult> {
    const config = readConfig();

    if (!config) {
      logger.info(
        { recipientCount: recipients.length, subject },
        'broadcast not sent: EMAIL_USER / EMAIL_APP_PASSWORD are unset',
      );
      return {
        sentCount: 0,
        recipientCount: recipients.length,
        reason: 'Email is not configured, so nothing was sent.',
      };
    }

    const transport = createTransport(config);

    try {
      const sendResults = await Promise.allSettled(
        recipients.map(async (recipient) => {
          await transport.sendMail({
            from: headerSafe(config.senderEmail),
            to: headerSafe(recipient.email),
            subject: headerSafe(subject),
            text: message,
          });
        }),
      );

      const sentCount = sendResults.filter((result) => result.status === 'fulfilled').length;
      const rejection = sendResults.find((result) => result.status === 'rejected');

      if (rejection?.status === 'rejected') {
        logger.error(
          {
            err: rejection.reason,
            sentCount,
            recipientCount: recipients.length,
            relay: `${config.host}:${config.port}`,
          },
          'broadcast email had failures',
        );
      }

      return {
        sentCount,
        recipientCount: recipients.length,
        ...(sentCount === 0 && recipients.length > 0
          ? { reason: `Nothing was sent: ${describeSmtpFailure(rejection?.reason)}.` }
          : {}),
      };
    } finally {
      transport.close();
    }
  }
}
