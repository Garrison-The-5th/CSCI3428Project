/**
 * File: assignment-service.ts
 * Description: Assignment tokens, guest sessions, scoping and resend throttling.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { randomBytes } from 'crypto';

import { logSecurityEvent } from '@/config/logger';
import { normaliseEmail } from '@/config/validation';
import { NotFoundError } from '@/controllers/http-errors';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AuthService from '@/services/auth-service/auth-service';
import DashboardService from '@/services/dashboard-service/dashboard-service';
import EmailService from '@/services/email-service/email-service';
import PublicationService, { NewIds } from '@/services/publication-service/publication-service';
import QuizService, { redactAnswers } from '@/services/quiz-service/quiz-service';

import { AssignmentType } from '../../../generated/prisma';

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is not a valid date`);
  return parsed;
}

/** Why a token was refused, so the public page can say something useful. */
export type TokenFailure = 'not-found' | 'revoked' | 'expired' | 'unavailable' | 'sign-in' | 'idle';

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
      expiresAt?: string | null;
    },
    /** The signed-in author. The learner hears from them, not a shared mailbox. */
    assigner?: { id: number; email: string; name: string | null } | null,
  ) {
    const email = normaliseEmail(data.email);

    // An explicit type still wins, so the API stays usable directly; the UI
    // stopped sending one and lets this decide.
    const type =
      data.type === undefined || data.type === null || data.type === ''
        ? await AssignmentService.chooseType(email)
        : AssignmentService.parseType(data.type);
    const courseId = data.courseId || null;
    const quizId = data.quizId || null;

    if (!courseId && !quizId) throw new Error('assign a course or a quiz');
    if (courseId && quizId) throw new Error('assign either a course or a quiz, not both');

    let title: string;
    if (courseId) {
      const course = await CurriculumGateway.getCourseById(courseId);
      if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
      title = course.title;
    } else {
      const quiz = await QuizGateway.getQuizById(quizId!);
      if (!quiz) throw new NotFoundError(`Quiz with ID ${quizId} not found`);
      title = quiz.title;
    }

    const existing = await AssignmentGateway.findDuplicate(email, courseId, quizId);
    if (existing) {
      throw new Error(`${email} is already assigned this item`);
    }

    // Progress is keyed on the User row for this address; make sure it exists.
    await AuthService.getOrCreateUser(email);

    const assignment = await AssignmentGateway.create({
      type,
      token: AssignmentService.generateToken(),
      email,
      courseId,
      quizId,
      assignedById: assigner?.id ?? null,
      dueDate: parseDate(data.dueDate, 'dueDate'),
      expiresAt: parseDate(data.expiresAt, 'expiresAt'),
    });

    // Telling them is the point of assigning, but a mail outage must not lose the
    // assignment itself — the record stands and `notifiedAt` stays null.
    const delivery = await EmailService.sendAssignmentEmail({
      to: email,
      type,
      title,
      kind: courseId ? 'course' : 'quiz',
      token: assignment.token,
      dueDate: assignment.dueDate,
      sender: assigner ?? null,
    });

    if (delivery.sent) {
      const now = new Date();
      await AssignmentGateway.markNotified(assignment.id, now, 1);
      return { ...assignment, notifiedAt: now, delivery };
    }

    return { ...assignment, delivery };
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
  static async resend(
    id: string,
    assigner?: { id: number; email: string; name: string | null } | null,
  ) {
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

    // Whoever originally set the work stays the sender when we know them, so a
    // reminder does not appear to come from a different person than the original.
    const sender = assignment.assignedBy ?? assigner ?? null;

    const delivery = await EmailService.sendAssignmentEmail({
      to: assignment.email,
      type: assignment.type,
      title,
      kind: assignment.courseId ? 'course' : 'quiz',
      token: assignment.token,
      dueDate: assignment.dueDate,
      sender,
      resend: true,
    });

    if (delivery.sent) {
      await AssignmentGateway.markNotified(id, allowance.windowStart, allowance.nextCount);
    }

    return delivery;
  }

  /** Moves one person's deadline without touching anyone else's. */
  static async setDueDate(id: string, dueDate: string | null) {
    const assignment = await AssignmentGateway.findById(id);
    if (!assignment) throw new NotFoundError(`Assignment with ID ${id} not found`);
    return AssignmentGateway.setDueDate(id, parseDate(dueDate, 'dueDate'));
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

    const assignment = await AssignmentGateway.findByToken(token);
    if (!assignment) throw new AssignmentError('not-found');

    // A platform assignment's token is an internal handle, not a credential. It
    // is never mailed out, so anything presenting one is either guessing or
    // holding a stale URL; either way the answer is to sign in.
    if (assignment.type === 'PLATFORM') throw new AssignmentError('sign-in');

    if (assignment.revokedAt) throw new AssignmentError('revoked');
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

  /** Records a module view, if that module is inside something assigned to them. */
  static async recordView(token: string, moduleId: string) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);

    const inAssigned = courses.some((course) =>
      course.modules.some((module) => module.id === moduleId),
    );
    if (!inAssigned) throw new Error('that module is not part of your assigned learning');

    return CurriculumGateway.recordModuleView(user.id, moduleId);
  }

  /**
   * Records that one piece of content was opened, and credits its module too —
   * the same pairing the signed-in path does, so a guest working through a
   * sequential course unlocks exactly as a member would.
   */
  static async recordElementView(token: string, elementId: string) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);

    const owner = courses
      .flatMap((course) => course.modules)
      .find((module) => module.elements.some((element) => element.id === elementId));
    if (!owner) throw new Error('that content is not part of your assigned learning');

    await CurriculumGateway.recordModuleView(user.id, owner.id);
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

  /** Grades and records a quiz attempt, if that quiz is assigned to them. */
  static async submitAttempt(token: string, quizId: string, answers: Record<string, string>) {
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
    const course = assignment.courseId
      ? await PublicationService.getLiveSnapshot(assignment.courseId)
      : null;
    const directQuiz = assignment.quizId
      ? await QuizGateway.getQuizById(assignment.quizId, true)
      : null;

    const courses = course ? [course] : [];
    // A course link carries the quizzes inside that course; a quiz link carries
    // just that quiz.
    const quizzes = course
      ? course.modules.flatMap((module) => module.quizzes)
      : directQuiz
        ? [directQuiz]
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
      return { newSectionIds: [], newModuleIds: [], newElementIds: [], newQuizIds: [] };
    }
    return PublicationService.getNewIdsForLearner(courseId, user.id);
  }

  /** Courses for the Learning tab, with quiz answers stripped. */
  static async getSessionCourses(token: string) {
    const { courses } = await AssignmentService.getSessionCatalogue(token);
    return courses.map((course) => ({
      ...course,
      modules: course.modules.map((module) => ({
        ...module,
        quizzes: module.quizzes.map(redactAnswers),
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
          contentUpdatedAt: row?.contentUpdatedAt ?? new Date(0),
          modules: course.modules.map((module) => ({
            id: module.id,
            estimatedMinutes: module.estimatedMinutes,
            quizzes: (module.quizzes ?? []).map((quiz) => ({ id: quiz.id })),
          })),
        };
      }),
    );

    // Dates come back off a JSON snapshot as strings, so they are rebuilt into
    // Dates for the dashboard, which does arithmetic on them.
    const dashboardQuizzes = quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      moduleId: quiz.moduleId,
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
            ids.newSectionIds.length +
              ids.newModuleIds.length +
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
      CurriculumGateway.getViewedModuleIds(user.id),
      CurriculumGateway.getViewedElementIds(user.id),
      QuizGateway.getAttemptsForUser(user.id),
    ]);

    const ownModules = new Set(courses.flatMap((c) => c.modules.map((m) => m.id)));
    const ownElements = new Set(
      courses.flatMap((c) => c.modules.flatMap((m) => m.elements.map((e) => e.id))),
    );
    const ownQuizzes = new Set(quizzes.map((q) => q.id));

    return {
      viewedModuleIds: views.map((v) => v.moduleId).filter((id) => ownModules.has(id)),
      viewedElementIds: elementViews.map((v) => v.elementId).filter((id) => ownElements.has(id)),
      attemptedQuizIds: [
        ...new Set(attempts.map((a) => a.quizId).filter((id) => ownQuizzes.has(id))),
      ],
    };
  }

  /** Who the guest is, for the profile menu and greeting. */
  static async getSessionUser(token: string) {
    const { user } = await AssignmentService.resolveToken(token);
    return { email: user.email, name: user.name };
  }

  // ---- Notes, for the holder of a course link ----

  /** The guest's own notes on one of their assigned courses. */
  static async getNotes(token: string, courseId: string) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);
    if (!courses.some((course) => course.id === courseId)) return [];
    return CurriculumGateway.getNotes(user.id, courseId);
  }

  static async createNote(token: string, courseId: string, body: string, moduleId?: string | null) {
    const { user, courses } = await AssignmentService.getSessionCatalogue(token);
    if (!courses.some((course) => course.id === courseId)) {
      throw new Error('that course is not part of your assigned learning');
    }
    if (!body?.trim()) throw new Error('note cannot be empty');

    return CurriculumGateway.createNote({
      userId: user.id,
      courseId,
      moduleId: moduleId || null,
      body: body.trim(),
    });
  }

  static async updateNote(token: string, noteId: string, body: string) {
    const { user } = await AssignmentService.resolveToken(token);
    if (!body?.trim()) throw new Error('note cannot be empty');
    // Scoped by userId, so a link cannot edit anyone else's note.
    const { count } = await CurriculumGateway.updateNote(noteId, user.id, body.trim());
    if (count === 0) throw new NotFoundError(`Note with ID ${noteId} not found`);
  }

  static async deleteNote(token: string, noteId: string) {
    const { user } = await AssignmentService.resolveToken(token);
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

    const course = target.courseId ? await CurriculumGateway.getCourseById(target.courseId) : null;

    const moduleIds = new Set(course?.modules.map((m) => m.id) ?? []);

    return Promise.all(
      assignments.map(async (assignment) => {
        const user = await AuthService.getUserByEmail(assignment.email);
        if (!user) {
          return {
            ...assignment,
            name: null,
            completedModules: 0,
            totalModules: moduleIds.size,
            percentComplete: 0,
            attempts: 0,
            lastActivityAt: null as Date | null,
          };
        }

        const [viewed, attempts] = await Promise.all([
          CurriculumGateway.getViewedModuleIds(user.id),
          QuizGateway.getAttemptsForUser(user.id),
        ]);

        const relevantQuizId = target.quizId;
        const relevant = viewed.filter((v) => moduleIds.has(v.moduleId));
        const completedModules = relevant.length;

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
          totalModules: moduleIds.size,
          completedModules,
          percentComplete:
            moduleIds.size === 0 ? 0 : Math.round((completedModules / moduleIds.size) * 100),
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
   * Every course that has been handed to someone, with how many people hold it
   * and how many have finished. Drives the Assigned learning cards on the admin
   * dashboard, which need the totals without any of the course content.
   */
  static async listAssignedCourses() {
    const assigned = await AssignmentGateway.listAssignedCourseIds();

    const cards = await Promise.all(
      assigned.map(async ({ courseId, count }) => {
        const course = await CurriculumGateway.getCourseById(courseId);
        if (!course) return null;

        const assignments = await AssignmentService.listWithProgress({ courseId });
        const completed = assignments.filter(
          (entry) => entry.totalModules > 0 && entry.completedModules >= entry.totalModules,
        ).length;
        const overdue = assignments.filter(
          (entry) =>
            entry.dueDate !== null &&
            entry.dueDate.getTime() < Date.now() &&
            entry.completedModules < entry.totalModules,
        ).length;

        return {
          courseId,
          title: course.title,
          imageData: course.imageData,
          imageType: course.imageType,
          published: course.published,
          totalModules: course.modules.length,
          assignedCount: count,
          completedCount: completed,
          overdueCount: overdue,
        };
      }),
    );

    return cards.filter((card): card is NonNullable<typeof card> => card !== null);
  }
}
