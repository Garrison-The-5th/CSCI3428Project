/**
 * File: assignment-service.ts
 * Description: Assignment tokens, guest sessions, scoping and resend throttling.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
import { createHash, randomBytes } from 'crypto';

import { logSecurityEvent } from '@/config/logger';
import {
  dueDateFromDays,
  endOfDueDay,
  isLockedOut,
  normaliseEmail,
  parseDaysRemaining,
} from '@/config/validation';
import { NotFoundError } from '@/controllers/http-errors';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway, { CourseReach } from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AuthService from '@/services/auth-service/auth-service';
import CourseMapService from '@/services/course-map-service/course-map-service';
import DashboardService from '@/services/dashboard-service/dashboard-service';
import EmailService from '@/services/email-service/email-service';
import PublicationService, { NewIds } from '@/services/publication-service/publication-service';
import QuizService, { redactAnswers } from '@/services/quiz-service/quiz-service';

import { AssignmentType, QuizType } from '../../../generated/prisma';

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is not a valid date`);
  return parsed;
}

/** Why a token was refused, so the public page can say something useful. */
export type TokenFailure =
  | 'not-found'
  | 'revoked'
  | 'expired'
  | 'unavailable'
  | 'sign-in'
  | 'idle'
  /** A one-time link that has been handed in and whose result has been read. */
  | 'completed';

/**
 * How long a link may sit unused before it stops working.
 *
 * §3.2.2 requires sessions to be "timed out after periods of inactivity", and a
 * guest link previously had no such bound — issued once, it worked forever
 * unless somebody remembered to revoke it. Ninety days is chosen against how
 * this is actually used: an induction sent to a contractor should still open
 * when they get round to it a month later, but a link found in an old inbox two
 * years on should not.
 *
 * The clock runs from last use, not from issue, so someone working through a
 * long course never has it expire underneath them. Re-sending the assignment
 * revives it, which is what the resend button is for.
 */
export const LINK_IDLE_TIMEOUT_MS = 90 * 24 * 60 * 60 * 1000;

export class AssignmentError extends Error {
  constructor(public reason: TokenFailure) {
    super(reason);
  }
}

/**
 * How hard a single assignment can be mailed about.
 *
 * The on/off switch re-sends whenever it is turned back on, which is the whole
 * point of it — but that also makes it a button someone can sit on. Rather than
 * disabling the switch or hiding the resend, both are always available and the
 * server refuses the send: a short cooldown stops accidental double-clicks and
 * fidgeting with the toggle, and a rolling daily cap stops anything determined.
 * The assignment itself still changes state either way, so turning a link off
 * and on always works even when the mail does not go.
 */
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESEND_WINDOW_LIMIT = 5;

/** Enough of an assignment row to decide whether another mail may go out. */
type Throttled = {
  notifiedAt: Date | null;
  notifyWindowStart: Date | null;
  notifyCount: number;
};

/** "in 4 minutes", for a refusal that says when to come back. */
function inWords(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export default class AssignmentService {
  /**
   * 32 random bytes as base64url — 256 bits, far past anything guessable, and safe
   * to drop straight into a URL.
   */
  static generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * What is stored in place of a token. A plain hash is enough — the token is
   * 256 random bits, so there is nothing to guess and nothing for a salt to
   * protect against — and it lets a token be found by its hash directly.
   */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Gives a link a fresh token and returns it. The previous URL stops working:
   * only a hash is kept, so the old token cannot be handed out again, and a
   * link that has to be shared again is safer replaced than repeated.
   */
  static async issueNewLink(id: string): Promise<string> {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);
    if (assignment.type !== 'LINK') {
      throw new Error('This person signs in to reach it, so there is no link to share');
    }
    const token = AssignmentService.generateToken();
    await AssignmentGateway.setTokenHash(id, AssignmentService.hashToken(token));
    return token;
  }

  /**
   * Refuses to hand out something the recipient could not open.
   *
   * `resolveToken` turns unpublished content into "This training is not
   * available right now", and until now nothing stopped a link being minted and
   * mailed for exactly that — so the author heard nothing, and the person on the
   * other end opened a dead end with no way to tell whose fault it was.
   *
   * It bites hardest on a one-time link, and that is how it was found. A course
   * and a quiz are both drafts until somebody publishes them (see
   * schema.prisma), and a link is the *only* way into a one-time quiz — there is
   * no Quizzes tab to fall back on, so the first link an author ever sends is
   * the first time they would discover the quiz was still a draft.
   *
   * A course needs its published flag *and* a snapshot behind it: publishing is
   * versioned, and `getLiveSnapshot` returns nothing until a version exists, so
   * a course flagged published with no version opens an empty catalogue rather
   * than a refusal — worse, because it looks like it worked.
   */
  private static assertSendable(
    item: { title: string; published: boolean; publishedVersion?: number },
    kind: 'course' | 'quiz',
  ): void {
    if (!item.published) {
      throw new Error(
        `"${item.title}" is still a draft, so a link to it would not open — publish the ` +
          `${kind} first, then send it`,
      );
    }

    if (item.publishedVersion !== undefined && item.publishedVersion < 1) {
      throw new Error(
        `"${item.title}" has no published version yet, so a link to it would open nothing — ` +
          'publish it, then send it',
      );
    }
  }

  /**
   * Assigns one course or one quiz to an email address.
   *
   * Two shapes, chosen by `type`:
   *   PLATFORM — they are enrolled and sign in normally to find it. The token is
   *              created but never published.
   *   LINK     — they get a URL that opens exactly this item with no login.
   *
   * Either way the assignment covers a single item, so someone given three
   * courses ends up with three assignments and, for LINK, three separate URLs.
   * Creates the User row for that address up front so progress has somewhere to
   * land before they ever open it.
   */
  static async assign(
    data: {
      email?: string;
      type?: string;
      courseId?: string | null;
      quizId?: string | null;
      dueDate?: string | null;
      /**
       * How long this person gets, in days. Overrides whatever length the course
       * or quiz carries; leave it out and that one is used.
       */
      daysRemaining?: number | string | null;
      expiresAt?: string | null;
    },
    /** The signed-in author. The learner hears from them, not a shared mailbox. */
    assigner?: { id: number } | null,
    /**
     * The origin the author is using the app on, so the link in their learner's
     * email points at the same place. See `config/app-url.ts`.
     */
    baseUrl?: string | null,
  ) {
    const email = normaliseEmail(data.email);

    // An explicit type still wins, so the API stays usable directly; the UI
    // stopped sending one and lets this decide.
    const suited = await AssignmentService.chooseType(email);
    let type =
      data.type === undefined || data.type === null || data.type === ''
        ? suited
        : AssignmentService.parseType(data.type);

    // A link acts as whoever owns the address. For somebody who signs in, that
    // would make a forwardable URL a second key to their account, so they are
    // given the work on their account instead. (A one-time quiz still goes by
    // link below — it has no other way in — and such a link cannot reach their
    // notes; see `notesOpenTo`.)
    if (type === 'LINK' && suited === 'PLATFORM') {
      throw new Error(
        `${email} has an account — assign it on the platform and they will find it when they sign in`,
      );
    }
    const courseId = data.courseId || null;
    const quizId = data.quizId || null;

    if (!courseId && !quizId) throw new Error('assign a course or a quiz');
    if (courseId && quizId) throw new Error('assign either a course or a quiz, not both');

    let title: string;
    /** The length of run the course or quiz itself sets, when it sets one. */
    let defaultDays: number | null = null;
    if (courseId) {
      const course = await CurriculumGateway.getCourseById(courseId);
      if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
      title = course.title;
      defaultDays = course.daysRemaining ?? null;

      // A quiz set built around a one-time link goes out as a link for the same
      // reason a bare one-time quiz does — see the quiz branch below. The
      // assignment names the course rather than the quiz, so without this the
      // kind would be chosen from whether the address has signed in before, and
      // sending one to a colleague with an account would quietly produce a
      // platform enrolment: no URL anywhere, and the quiz sitting on their
      // Quizzes tab, which is the one thing a one-time link must never do.
      if (await QuizGateway.findOneTimeQuiz(courseId)) type = 'LINK';

      // Publishing is what makes the whole set reachable, quizzes included, so
      // this one check covers a one-time link as well: it cannot be shared until
      // its set is published, which is the only state in which the link opens
      // anything at all.
      AssignmentService.assertSendable(course, 'course');
    } else {
      const quiz = await QuizGateway.getQuizById(quizId!);
      if (!quiz) throw new NotFoundError(`Quiz with ID ${quizId} not found`);
      title = quiz.title;
      // A quiz that sits in a course gets the course's length, not one of its
      // own: it is due with the course around it, and an exam inside a lesson
      // that fell due a week before the lesson did would be nobody's idea of one
      // deadline.
      defaultDays = await AssignmentService.daysFor(quiz);

      // A learning check is part of the section around it. Handing one out on its
      // own would strip it of the thing it is checking, so it is not assignable.
      if (quiz.type === QuizType.LEARNING_CHECK) {
        throw new Error(
          'a learning check is taken inside its lesson, so it cannot be sent on its own',
        );
      }

      // A one-time quiz is defined by being reachable only through its link, so
      // it always goes out as one — even to somebody with a perfectly good
      // account, who would otherwise find it waiting on their Quizzes tab.
      if (quiz.type === QuizType.ONE_TIME) type = 'LINK';

      AssignmentService.assertSendable(quiz, 'quiz');
    }

    const existing = await AssignmentGateway.findDuplicate(email, courseId, quizId);
    if (existing) {
      throw new Error(`${email} is already assigned this item`);
    }

    // Progress is keyed on the User row for this address; make sure it exists.
    await AuthService.getOrCreateUser(email);

    // Kept in memory for the email and the reply; only its hash is stored.
    const token = AssignmentService.generateToken();
    const assignment = await AssignmentGateway.create({
      type,
      tokenHash: AssignmentService.hashToken(token),
      email,
      courseId,
      quizId,
      assignedById: assigner?.id ?? null,
      dueDate: AssignmentService.deadlineFor(data, defaultDays),
      expiresAt: parseDate(data.expiresAt, 'expiresAt'),
    });

    // Telling them is the point of assigning, but a mail outage must not lose the
    // assignment itself — the record stands and `notifiedAt` stays null.
    const delivery = await EmailService.sendAssignmentEmail({
      to: email,
      type,
      title,
      kind: courseId ? 'course' : 'quiz',
      token,
      dueDate: assignment.dueDate,
      baseUrl,
    });

    // The token goes back to the author this once, so a link can be copied the
    // moment it is made. It cannot be read back later.
    const created: Omit<typeof assignment, 'tokenHash'> & { tokenHash?: string } = {
      ...assignment,
    };
    delete created.tokenHash;
    const link = type === 'LINK' ? { token } : {};

    if (delivery.sent) {
      const now = new Date();
      await AssignmentGateway.markNotified(assignment.id, now, 1);
      return { ...created, ...link, notifiedAt: now, delivery };
    }

    return { ...created, ...link, delivery };
  }

  /**
   * How long a quiz gives the person it is handed to.
   *
   * Its own length when it stands alone. When it sits in a course, the course's
   * — see the note at the call site.
   */
  static async daysFor(quiz: { sectionId: string | null; daysRemaining: number | null }) {
    if (!quiz.sectionId) return quiz.daysRemaining ?? null;

    const section = await CurriculumGateway.getSectionById(quiz.sectionId);
    if (!section) return quiz.daysRemaining ?? null;

    const course = await CurriculumGateway.getCourseById(section.courseId);
    return course?.daysRemaining ?? null;
  }

  /**
   * When this person's work is due.
   *
   * A deadline is set as a length now — "they get fourteen days" — rather than
   * as a date, because the same course handed out today and again next month
   * should give each learner the same run at it, which one fixed date on the
   * course cannot do. The length is turned into a date here, once, at the moment
   * the assignment is made, so from then on every reader of `dueDate` — the
   * dashboard, the reminder mail, the roster — sees an ordinary deadline and
   * needs to know nothing about how it was arrived at.
   *
   * An explicit `dueDate` still wins, so the API stays usable directly and one
   * person's deadline can still be set by hand. Failing that, an explicit
   * `daysRemaining` on the request; failing that, the length the course or quiz
   * carries; and failing that, no deadline at all.
   */
  static deadlineFor(
    data: { dueDate?: string | null; daysRemaining?: number | string | null },
    defaultDays: number | null,
  ): Date | null {
    // Settled to 11:59 PM for the same reason `setDueDate` does it: a date
    // picker sends a bare day, and midnight on it is a day short.
    const explicit = endOfDueDay(parseDate(data.dueDate, 'dueDate'));
    if (explicit) return explicit;

    const days = parseDaysRemaining(data.daysRemaining, 'daysRemaining') ?? defaultDays;
    return dueDateFromDays(days);
  }

  /**
   * Whether another mail about this assignment may go out now, and why not when
   * it may not. Read-only — the caller stamps the counters after a send actually
   * succeeds, so a refused Gmail call does not burn an allowance.
   */
  static checkResendAllowance(assignment: Throttled): {
    allowed: boolean;
    reason?: string;
    windowStart: Date;
    nextCount: number;
  } {
    const now = Date.now();
    const windowOpen =
      assignment.notifyWindowStart !== null &&
      now - assignment.notifyWindowStart.getTime() < RESEND_WINDOW_MS;

    // A lapsed window starts fresh, which is what makes the cap rolling rather
    // than a permanent ceiling on how often someone may ever be reminded.
    const windowStart = windowOpen ? assignment.notifyWindowStart! : new Date();
    const used = windowOpen ? assignment.notifyCount : 0;

    if (assignment.notifiedAt) {
      const since = now - assignment.notifiedAt.getTime();
      if (since < RESEND_COOLDOWN_MS) {
        return {
          allowed: false,
          reason: `Already emailed a moment ago — you can send again in ${inWords(
            RESEND_COOLDOWN_MS - since,
          )}.`,
          windowStart,
          nextCount: used + 1,
        };
      }
    }

    if (used >= RESEND_WINDOW_LIMIT) {
      const resetsIn = RESEND_WINDOW_MS - (now - windowStart.getTime());
      return {
        allowed: false,
        reason:
          `That is ${RESEND_WINDOW_LIMIT} emails about this in a day, which is the limit. ` +
          `You can send again in ${inWords(resetsIn)}.`,
        windowStart,
        nextCount: used + 1,
      };
    }

    return { allowed: true, windowStart, nextCount: used + 1 };
  }

  /**
   * Emails the assignment again — the resend button, and what turning a link back
   * on does. Rate limited; a refusal comes back as `sent: false` with a reason
   * rather than as an error, because the caller's other work (flipping the
   * switch) has already succeeded and must stand.
   */
  static async resend(id: string, baseUrl?: string | null) {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);

    const allowance = AssignmentService.checkResendAllowance(assignment);
    if (!allowance.allowed) {
      return { sent: false, reason: allowance.reason } as const;
    }

    let title: string;
    if (assignment.courseId) {
      const course = await CurriculumGateway.getCourseById(assignment.courseId);
      if (!course) throw new NotFoundError('That course no longer exists');
      title = course.title;
    } else {
      const quiz = await QuizGateway.getQuizById(assignment.quizId!);
      if (!quiz) throw new NotFoundError('That quiz no longer exists');
      title = quiz.title;
    }

    // Only a hash of the old token is kept, so a link is re-sent as a new one;
    // the URL in the earlier email stops working. A platform assignment's email
    // carries no token, so its stored one is left alone.
    const token =
      assignment.type === 'LINK'
        ? await AssignmentService.issueNewLink(id)
        : AssignmentService.generateToken();

    const delivery = await EmailService.sendAssignmentEmail({
      to: assignment.email,
      type: assignment.type,
      title,
      kind: assignment.courseId ? 'course' : 'quiz',
      token,
      dueDate: assignment.dueDate,
      resend: true,
      baseUrl,
    });

    if (delivery.sent) {
      await AssignmentGateway.markNotified(id, allowance.windowStart, allowance.nextCount);
    }

    return delivery;
  }

  /**
   * Moves one person's deadline without touching anyone else's.
   *
   * A date picker sends a bare day, which parses as midnight — and a deadline at
   * midnight closes somebody out on the morning of the day they were told they
   * had. It is settled to 11:59 PM here, so a date typed in by hand means what
   * every other deadline in the system means.
   */
  static async setDueDate(id: string, dueDate: string | null) {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);
    return AssignmentGateway.setDueDate(id, endOfDueDay(parseDate(dueDate, 'dueDate')));
  }

  static parseType(value: unknown): AssignmentType {
    if (value === undefined || value === null || value === '') return 'LINK';
    if (value !== 'LINK' && value !== 'PLATFORM') {
      throw new Error('type must be PLATFORM or LINK');
    }
    return value;
  }

  /**
   * Which kind of assignment suits this person, worked out rather than asked.
   *
   * The choice was never really a preference — it follows from whether they can
   * sign in. Someone with an account gets PLATFORM and a link to the login page,
   * because the course belongs on their Learning tab. An address we have never
   * seen, or a row created by a previous assignment and never signed into, gets
   * LINK: telling them to sign in would send them to a login they cannot pass.
   *
   * Having signed in is the tell — not having a name. Not every Keycloak realm
   * sends a name claim, and reading a missing one as "no account" would post a
   * private link to people who have perfectly good logins.
   */
  static async chooseType(email: string): Promise<AssignmentType> {
    const user = await AuthService.getUserByEmail(email);
    return user?.lastSignInAt ? 'PLATFORM' : 'LINK';
  }

  /**
   * Turns a public token into the assignment and the User it belongs to. Throws
   * AssignmentError with the specific reason so the page can distinguish
   * "revoked" from "expired" from "never existed".
   */
  static async resolveToken(token: string) {
    if (!token) throw new AssignmentError('not-found');

    const assignment = await AssignmentGateway.findByTokenHash(AssignmentService.hashToken(token));
    if (!assignment) throw new AssignmentError('not-found');

    // A platform assignment's token is an internal handle, not a credential. It
    // is never mailed out, so anything presenting one is either guessing or
    // holding a stale URL; either way the answer is to sign in.
    if (assignment.type === 'PLATFORM') throw new AssignmentError('sign-in');

    if (assignment.revokedAt) {
      // A one-time link that closed itself once its result had been read says so,
      // rather than blaming the author for having turned it off. Both states are
      // `revokedAt` — that is deliberate, so the author's on switch works on
      // either — and what separates them is having been completed and read.
      throw new AssignmentError(
        assignment.completedAt && assignment.resultsSeenAt ? 'completed' : 'revoked',
      );
    }
    if (assignment.expiresAt && assignment.expiresAt.getTime() < Date.now()) {
      throw new AssignmentError('expired');
    }

    // Inactivity timeout (§3.2.2). Measured from the last time the link was
    // actually opened; an assignment never opened at all is measured from when
    // it was handed over, so a link nobody ever used does not live forever.
    const lastUsed = (assignment.lastAccessedAt ?? assignment.assignedAt).getTime();
    if (Date.now() - lastUsed > LINK_IDLE_TIMEOUT_MS) {
      logSecurityEvent('token.rejected', {
        email: assignment.email,
        resource: assignment.id,
        reason: 'idle timeout',
      });
      throw new AssignmentError('idle');
    }

    // The link must not outlive the content it points at.
    const target = assignment.courseId ? assignment.course : assignment.quiz;
    if (!target || target.deletedAt || !target.published) {
      throw new AssignmentError('unavailable');
    }

    const user = await AuthService.getOrCreateUser(assignment.email);
    await AssignmentGateway.touch(assignment.id);

    return { assignment, user };
  }

  /** Records a section view, if that section is inside something assigned to them. */
  static async recordView(token: string, sectionId: string) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);

    const inAssigned = courses.some((course) =>
      course.sections.some((section) => section.id === sectionId),
    );
    if (!inAssigned) throw new Error('that section is not part of your assigned learning');

    return CurriculumGateway.recordSectionView(user.id, sectionId);
  }

  /**
   * Records that one piece of content was opened, and credits its section too —
   * the same pairing the signed-in path does, so a guest working through a
   * sequential course unlocks exactly as a member would.
   */
  static async recordElementView(token: string, elementId: string) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);

    const owner = courses
      .flatMap((course) => course.sections)
      .find((section) => section.elements.some((element) => element.id === elementId));
    if (!owner) throw new Error('that content is not part of your assigned learning');

    await CurriculumGateway.recordSectionView(user.id, owner.id);
    return CurriculumGateway.recordElementView(user.id, elementId);
  }

  /**
   * Starts the clock on an assigned quiz, or reports the one already running.
   * The same server-anchored deadline a signed-in learner gets, so a guest who
   * closes the tab comes back to the time they had left, not a fresh allowance.
   */
  static async startQuiz(token: string, quizId: string) {
    const { user, quizzes } = await AssignmentService.getSessionCatalogue(token);

    if (!quizzes.some((candidate) => candidate.id === quizId)) {
      throw new Error('that quiz is not part of your assigned learning');
    }

    return QuizService.startSession(user.id, quizId);
  }

  /**
   * Whether this link holder is already part way through an assigned quiz,
   * without starting one if they are not — the guest half of the details screen
   * the player shows in front of a quiz nobody has opened yet.
   */
  static async peekQuiz(token: string, quizId: string) {
    const { user, quizzes } = await AssignmentService.getSessionCatalogue(token);

    if (!quizzes.some((candidate) => candidate.id === quizId)) {
      throw new Error('that quiz is not part of your assigned learning');
    }

    return QuizService.peekSession(user.id, quizId);
  }

  /** Grades and records a quiz attempt, if that quiz is assigned to them. */
  static async submitAttempt(
    token: string,
    quizId: string,
    answers: Record<string, string | string[]>,
  ) {
    const { user, quizzes } = await AssignmentService.getSessionCatalogue(token);

    if (!quizzes.some((candidate) => candidate.id === quizId)) {
      throw new Error('that quiz is not part of your assigned learning');
    }

    // Grading and closing the run live in one place, so a guest and a signed-in
    // learner cannot drift apart on how the timer is enforced.
    return QuizService.submitAttempt(user.id, quizId, answers);
  }

  // ---- Guest session: everything assigned to this email ----

  /**
   * The catalogue a link opens: exactly the one course or one quiz it was issued
   * for, and nothing else.
   *
   * A link is per item, so someone assigned three courses gets three links and
   * each opens only its own. Widening a link to everything that email has been
   * given would mean handing over one course quietly handed over the rest, and
   * would make revoking a single link pointless while any other still worked.
   */
  static async getSessionCatalogue(token: string) {
    const { assignment, user } = await AssignmentService.resolveToken(token);

    // The published snapshot, exactly as a signed-in learner gets. A link holder
    // must not be a way around versioned publishing — nothing unpublished is
    // reachable through one either.
    const snapshot = assignment.courseId
      ? await PublicationService.getLiveSnapshot(assignment.courseId)
      : null;
    const directQuiz = assignment.quizId
      ? await QuizGateway.getQuizById(assignment.quizId, true)
      : null;

    // The deadline belongs to the link, not to the course behind it: the same
    // course sent to two people on two days falls due on two dates. Stamping it
    // on here means every reader downstream — the dashboard, the landing page,
    // the lock — sees this holder's date without knowing a link was involved.
    const due =
      endOfDueDay(assignment.dueDate) ??
      endOfDueDay(snapshot?.dueDate ? new Date(snapshot.dueDate) : null);
    /*
      Narrowed to this holder's own branches, exactly as a signed-in learner's is.

      A link holder was being handed the published snapshot whole, which on a
      directed course is every branch of the map at once — all the content, in
      authoring order, with none of the layer quizzes gating anything. They
      answer those quizzes like anybody else and their choices are recorded, so
      the only thing missing was reading them back.
    */
    const mine = snapshot ? await CourseMapService.forLearner(snapshot, user.id) : null;

    const course = mine
      ? // `locked` is answered here for the same reason a signed-in learner's is
        // answered on the server: a lock the browser works out from its own
        // clock is one the holder of the link can move.
        { ...mine, dueDate: due, locked: isLockedOut(due, mine.lockAfterDue) }
      : null;

    const courses = course ? [course] : [];
    // A course link carries the quizzes inside that course; a quiz link carries
    // just that quiz.
    const quizzes = course
      ? // A quiz inside the course is due with the course around it, so the
        // link's date reaches those too rather than leaving each quiz to
        // whatever date its own row happens to carry.
        course.sections.flatMap((section) =>
          section.quizzes.map((quiz) => ({ ...quiz, dueDate: due })),
        )
      : directQuiz
        ? [{ ...directQuiz, dueDate: due ?? endOfDueDay(directQuiz.dueDate) }]
        : [];

    return { user, assignment, assignments: [assignment], courses, quizzes };
  }

  /**
   * What is new to this link holder on one of their assigned courses.
   *
   * A guest is not a different kind of learner. They have a User row, their
   * progress is recorded against it, and they can have been part way through
   * when a new version went live — so they get the same marks a signed-in
   * learner would.
   */
  static async getSessionNewIds(token: string, courseId: string): Promise<NewIds> {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);
    if (!courses.some((course) => course.id === courseId)) {
      return { newModuleIds: [], newSectionIds: [], newElementIds: [], newQuizIds: [] };
    }
    return PublicationService.getNewIdsForLearner(courseId, user.id);
  }

  /** Courses for the Learning tab, with quiz answers stripped. */
  static async getSessionCourses(token: string) {
    const { courses } = await AssignmentService.getSessionCatalogue(token);
    return courses.map((course) => ({
      ...course,
      sections: course.sections.map((section) => ({
        ...section,
        quizzes: section.quizzes.map(redactAnswers),
      })),
    }));
  }

  /** Quizzes for the Quizzes tab, with answers stripped. */
  static async getSessionQuizzes(token: string) {
    const { quizzes } = await AssignmentService.getSessionCatalogue(token);
    return quizzes.map(redactAnswers);
  }

  /** The same dashboard a signed-in learner gets, over assigned content only. */
  static async getSessionDashboard(token: string) {
    const { user, courses, quizzes } = await AssignmentService.getSessionCatalogue(token);

    // A snapshot has no contentUpdatedAt — that stamp lives on the course row —
    // so it is read alongside. Without it the "new content since you finished"
    // notice could never fire for a link holder.
    const withStamps = await Promise.all(
      courses.map(async (course) => {
        const row = await CurriculumGateway.getCourseById(course.id);
        return {
          id: course.id,
          title: course.title,
          required: course.required,
          dueDate: course.dueDate ? new Date(course.dueDate) : null,
          lockAfterDue: course.lockAfterDue,
          contentUpdatedAt: row?.contentUpdatedAt ?? new Date(0),
          sections: course.sections.map((section) => ({
            id: section.id,
            estimatedMinutes: section.estimatedMinutes,
            quizzes: (section.quizzes ?? []).map((quiz) => ({ id: quiz.id })),
          })),
        };
      }),
    );

    // Dates come back off a JSON snapshot as strings, so they are rebuilt into
    // Dates for the dashboard, which does arithmetic on them.
    const dashboardQuizzes = quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      sectionId: quiz.sectionId,
      dueDate: quiz.dueDate ? new Date(quiz.dueDate) : null,
      questions: quiz.questions.map((question) => ({ id: question.id })),
    }));

    // Same new-content rule a signed-in learner gets — the snapshots are already
    // loaded, so this reuses them rather than reading each one twice.
    const newCounts = new Map(
      await Promise.all(
        courses.map(async (course): Promise<[string, number]> => {
          const ids = await PublicationService.getNewIdsForLearner(course.id, user.id, course);
          return [
            course.id,
            ids.newModuleIds.length +
              ids.newSectionIds.length +
              ids.newElementIds.length +
              ids.newQuizIds.length,
          ];
        }),
      ),
    );

    return DashboardService.build(user.id, withStamps, dashboardQuizzes, newCounts);
  }

  /** What the guest has done, scoped to their assigned content. */
  static async getSessionProgress(token: string) {
    const { user, courses, quizzes } = await AssignmentService.getSessionCatalogue(token);
    const [views, elementViews, attempts] = await Promise.all([
      CurriculumGateway.getViewedSectionIds(user.id),
      CurriculumGateway.getViewedElementIds(user.id),
      QuizGateway.getAttemptsForUser(user.id),
    ]);

    const ownSections = new Set(courses.flatMap((c) => c.sections.map((m) => m.id)));
    const ownElements = new Set(
      courses.flatMap((c) => c.sections.flatMap((m) => m.elements.map((e) => e.id))),
    );
    const ownQuizzes = new Set(quizzes.map((q) => q.id));

    return {
      viewedSectionIds: views.map((v) => v.sectionId).filter((id) => ownSections.has(id)),
      viewedElementIds: elementViews.map((v) => v.elementId).filter((id) => ownElements.has(id)),
      // Same shape a signed-in learner gets, so Continue resumes at the last
      // thing a link holder opened rather than sending them back to the start.
      elementViews: elementViews
        .filter((v) => ownElements.has(v.elementId))
        .map((v) => ({ elementId: v.elementId, viewedAt: v.viewedAt.toISOString() })),
      attemptedQuizIds: [
        ...new Set(attempts.map((a) => a.quizId).filter((id) => ownQuizzes.has(id))),
      ],
    };
  }

  /** Who the guest is, for the profile menu and greeting. */
  /**
   * Opening the link, and closing it behind them.
   *
   * Called exactly once per page load — by the entry page when the link is first
   * opened, and by the guest provider on every load after that, which is what
   * makes it the place that counts visits. `resolveToken` cannot do the counting:
   * it runs on every request, and one page makes several.
   *
   * A completed one-time link is not shut the instant the paper goes in. The
   * holder gets one more visit, so that reloading, or coming back to the tab,
   * lands on their result and the marked answers rather than on an error about a
   * link that worked a moment ago. The load after that closes it — and closes it
   * exactly as an author would, by stamping `revokedAt`, so the roster shows the
   * switch off and the author can turn it back on.
   *
   * Stamping `resultsSeenAt` here does not break the visit it is stamped in:
   * nothing else reads it, and `resolveToken` goes on letting the rest of that
   * page's requests through until the revoke lands on the next load.
   */
  static async getSessionUser(token: string) {
    const { assignment, user } = await AssignmentService.resolveToken(token);

    if (assignment.completedAt) {
      if (assignment.resultsSeenAt) {
        await AssignmentGateway.revoke(assignment.id);
        throw new AssignmentError('completed');
      }
      await AssignmentGateway.markResultsSeen(assignment.id);
    }

    return { email: user.email, name: user.name };
  }

  // ---- Notes, for the holder of a course link ----

  /**
   * Whether a link session may touch notes. Not when the address belongs to
   * somebody who signs in: a link acts as that person's record, and their notes
   * are private to their account — anyone forwarded the link could otherwise
   * read or rewrite them. They see their notes when they sign in.
   */
  private static notesOpenTo(user: { lastSignInAt: Date | null }): boolean {
    return user.lastSignInAt === null;
  }

  private static assertNotesOpen(user: { lastSignInAt: Date | null }) {
    if (!AssignmentService.notesOpenTo(user)) {
      throw new Error('Your notes are kept on your account — sign in to see and edit them.');
    }
  }

  /** The guest's own notes on one of their assigned courses. */
  static async getNotes(token: string, courseId: string) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);
    if (!AssignmentService.notesOpenTo(user)) return [];
    if (!courses.some((course) => course.id === courseId)) return [];
    return CurriculumGateway.getNotes(user.id, courseId);
  }

  static async createNote(
    token: string,
    courseId: string,
    body: string,
    sectionId?: string | null,
  ) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);
    AssignmentService.assertNotesOpen(user);
    if (!courses.some((course) => course.id === courseId)) {
      throw new Error('that course is not part of your assigned learning');
    }
    if (!body?.trim()) throw new Error('note cannot be empty');

    return CurriculumGateway.createNote({
      userId: user.id,
      courseId,
      sectionId: sectionId || null,
      body: body.trim(),
    });
  }

  static async updateNote(token: string, noteId: string, body: string) {
    const { user } = await AssignmentService.resolveToken(token);
    AssignmentService.assertNotesOpen(user);
    if (!body?.trim()) throw new Error('note cannot be empty');
    // Scoped by userId, so a link cannot edit anyone else's note.
    const { count } = await CurriculumGateway.updateNote(noteId, user.id, body.trim());
    if (count === 0) throw new NotFoundError(`Note with ID ${noteId} not found`);
  }

  static async deleteNote(token: string, noteId: string) {
    const { user } = await AssignmentService.resolveToken(token);
    AssignmentService.assertNotesOpen(user);
    // Scoped by userId, so a link cannot delete anyone else's note.
    const { count } = await CurriculumGateway.deleteNote(noteId, user.id);
    if (count === 0) throw new NotFoundError(`Note with ID ${noteId} not found`);
  }

  // ---- Author-facing ----

  /** Assignments for a course or quiz, each with how far that person has got. */
  static async listWithProgress(target: { courseId?: string; quizId?: string }) {
    const assignments = target.courseId
      ? await AssignmentGateway.listForCourse(target.courseId)
      : await AssignmentGateway.listForQuiz(target.quizId!);

    /*
      Measured against the published version, not the rows an author is editing.

      A roster built from the draft moved everybody's percentage the moment
      somebody added a section — content no learner could see yet — and disagreed
      with the figure the learner's own dashboard showed them. The live rows are
      the fallback for a course with no version behind it at all, which is the
      only case where there is nothing published to measure.
    */
    const published = target.courseId
      ? await PublicationService.getLiveSnapshot(target.courseId)
      : null;
    const course =
      published ??
      (target.courseId ? await CurriculumGateway.getCourseById(target.courseId) : null);

    /*
      And against each learner's own path through it.

      On a directed course the sections differ per person, so this cannot be
      hoisted out of the loop the way a fixed course's can — see
      `CourseMapService.forLearner`. It costs one extra read per learner and only
      on a course built from a map.
    */
    const sectionsFor = async (userId: number | null) =>
      new Set(
        course
          ? (await CourseMapService.forLearner(course, userId)).sections.map(
              (section) => section.id,
            )
          : [],
      );

    const everyone = await sectionsFor(null);

    return Promise.all(
      assignments.map(async (assignment) => {
        const user = await AuthService.getUserByEmail(assignment.email);
        if (!user) {
          return {
            ...assignment,
            name: null,
            completedSections: 0,
            // Nobody to narrow for, so this is what a learner who has answered
            // nothing would be given — which is what they are.
            totalSections: everyone.size,
            percentComplete: 0,
            attempts: 0,
            lastActivityAt: null as Date | null,
          };
        }

        const sectionIds = await sectionsFor(user.id);

        const [viewed, attempts] = await Promise.all([
          CurriculumGateway.getViewedSectionIds(user.id),
          QuizGateway.getAttemptsForUser(user.id),
        ]);

        const relevantQuizId = target.quizId;
        const relevant = viewed.filter((v) => sectionIds.has(v.sectionId));
        const completedSections = relevant.length;

        // Latest of anything they did, so the list can be read as "who has gone
        // quiet" rather than only "who opened the link".
        const stamps = [
          ...relevant.map((v) => v.viewedAt),
          ...attempts.map((a) => a.completedAt),
          ...(assignment.lastAccessedAt ? [assignment.lastAccessedAt] : []),
        ];

        return {
          ...assignment,
          name: user.name,
          totalSections: sectionIds.size,
          completedSections,
          percentComplete:
            sectionIds.size === 0 ? 0 : Math.round((completedSections / sectionIds.size) * 100),
          attempts: relevantQuizId
            ? attempts.filter((a) => a.quizId === relevantQuizId).length
            : attempts.length,
          lastActivityAt: stamps.length
            ? stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest))
            : null,
        };
      }),
    );
  }

  static async revoke(id: string) {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);
    return AssignmentGateway.revoke(id);
  }

  /**
   * Turning a link back on.
   *
   * Also forgets that the result has already been read, so a one-time link an
   * author reopens gives the holder their result again rather than closing
   * itself on the first load — turning it on and having it die immediately is
   * not a switch that works.
   *
   * `completedAt` is deliberately left alone. The quiz itself refuses a second
   * attempt whatever this row says (see `QuizService.startSession`), so clearing
   * it would not hand out another go — it would only make the roster claim the
   * quiz had never been sat.
   */
  static async restore(id: string) {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);
    return AssignmentGateway.restore(id);
  }

  /**
   * Takes an assignment away, and with it everything the person had done inside
   * it. Re-assigning later starts them from scratch.
   *
   * The wipe is scoped to the item that was taken away, so someone who holds two
   * courses keeps their progress on the one they still have. Notes are not
   * progress and are left alone — they are the learner's own writing, and losing
   * them would be a surprise rather than a reset.
   */
  static async remove(id: string) {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);

    const user = await AuthService.getUserByEmail(assignment.email);
    if (user) {
      if (assignment.courseId) {
        await AssignmentGateway.clearCourseProgress(user.id, assignment.courseId);
      } else if (assignment.quizId) {
        await AssignmentGateway.clearQuizProgress(user.id, assignment.quizId);
      }
    }

    return AssignmentGateway.delete(id);
  }

  /**
   * Every course this person owns or is named on, with how many people hold it
   * and how many have finished.
   *
   * All of their courses, not only the ones that have been handed to somebody.
   * A card whose count is zero is the useful case, not the empty one: it is how
   * an author sees that a finished course has reached nobody yet, and listing
   * only courses with assignments meant the page could not answer the one
   * question worth asking of it. It is also the way into a course's roster, and
   * a course with no roster still needs a way in to acquire one.
   *
   * Scoped by the same rule as the course itself: someone else's programme is
   * not summarised on your dashboard.
   */
  static async listAssignedCourses(userId: number, isGlobalAuthor: CourseReach) {
    const [assigned, reachable] = await Promise.all([
      AssignmentGateway.listAssignedCourseIds(),
      CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor),
    ]);

    const countById = new Map(assigned.map(({ courseId, count }) => [courseId, count]));

    const cards = await Promise.all(
      reachable
        .map((courseId) => ({ courseId, count: countById.get(courseId) ?? 0 }))
        .map(async ({ courseId, count }) => {
          const course = await CurriculumGateway.getCourseById(courseId);
          if (!course) return null;

          // Skipped for a course nobody holds: the roster read is the expensive
          // part of this card, and its answer is already known to be empty.
          const assignments =
            count === 0 ? [] : await AssignmentService.listWithProgress({ courseId });
          const completed = assignments.filter(
            (entry) => entry.totalSections > 0 && entry.completedSections >= entry.totalSections,
          ).length;
          const overdue = assignments.filter(
            (entry) =>
              entry.dueDate !== null &&
              entry.dueDate.getTime() < Date.now() &&
              entry.completedSections < entry.totalSections,
          ).length;

          return {
            courseId,
            title: course.title,
            // Carried so the dashboard can file a quiz set under Quizzes rather
            // than among the lessons. The two are handed out and chased in the
            // same way, which is why they share this list, but they are not the
            // same thing to read about: a quiz set has no sections to be part
            // way through, so a row of them mixed in among courses invites the
            // reader to compare numbers that do not mean the same thing.
            kind: course.kind,
            imageData: course.imageData,
            imageType: course.imageType,
            published: course.published,
            totalSections: course.sections.length,
            assignedCount: count,
            completedCount: completed,
            overdueCount: overdue,
          };
        }),
    );

    return cards.filter((card): card is NonNullable<typeof card> => card !== null);
  }
}
