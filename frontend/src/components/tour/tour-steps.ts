/**
 * File: tour-steps.ts
 * Description: The first-login walkthrough's script — every step, in order, with all
 *   of its wording.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */

/**
 * The script the tour engine plays.
 *
 * Everything a learner reads in the tour is in this file and nowhere else, so
 * the wording can be rewritten without opening the engine. The order is fixed
 * by the product brief; the server stores a step *index* and refuses one past
 * the end, so adding or removing a step means changing `TOUR_STEP_COUNT` in
 * `backend/src/config/validation.ts` too (a test pins the two together).
 *
 * Only learner items are ever taught. Authors and admins see extra sidebar
 * items, but nothing here points at them, and targets are found by their
 * `data-tour` attribute rather than by position — so extra items in the rail
 * can never shift what a step highlights.
 *
 * Routes may contain `:tutorial`, which the engine fills in with the default
 * tutorial's course id.
 */

/** How a step moves on. */
export type TourAdvance =
  /** A Next button in the card. */
  | { kind: 'next' }
  /** The learner goes somewhere themselves — the step waits for that route. */
  | { kind: 'route'; to: string }
  /**
   * The learner does something a page reports with `signalTour(name)` — used
   * where the thing to learn moves nothing in the URL.
   */
  | { kind: 'signal'; name: string }
  /** The last step. Its button finishes the tour. */
  | { kind: 'finish' };

export interface TourStep {
  /** Stable name, for tests and for reading the script. */
  id: string;
  /**
   * The routes this step belongs on. The first is where the engine sends the
   * learner when the step starts or when they ask to continue the tour; the
   * rest are other places the step is still in the right place, such as the
   * Learning page in the tutorial-card step's fallback.
   */
  routes: string[];
  /**
   * The `data-tour` name(s) to spotlight, best first: the first one found on the
   * page is used. Absent means a centred card with nothing highlighted.
   */
  target?: string[];
  /** Further targets lit alongside the main one — several small items in one step. */
  alsoHighlight?: string[];
  /** Keep the sidebar open for this step. On narrow screens it is closed otherwise. */
  sidebar?: boolean;
  title: string;
  body: string;
  /** Said instead of `body` to somebody here on an assignment link. */
  guestBody?: string;
  advance: TourAdvance;
  /**
   * What to show when the target never appears — the page finished loading
   * without it, or it took too long. Either a different target with its own
   * wording, or (without `target`) a centred card. Without this a missing
   * target falls back to a centred card carrying the step's own wording.
   */
  fallback?: {
    target?: string;
    body: string;
    /** For a fallback that cannot do what the step was waiting for: move on with Next. */
    advance?: TourAdvance;
  };
  /** Label for the action button; defaults to Next, or Finish on the last step. */
  actionLabel?: string;
}

/** Name of the signal the course player sends when the learner steps with Next or →. */
export const PLAYER_STEP_SIGNAL = 'player-step';

export const TOUR_STEPS: TourStep[] = [
  // Step 1
  {
    id: 'welcome',
    routes: ['/'],
    title: 'Welcome',
    body:
      'This short tour shows you around: the menu on the left, then a first look inside a ' +
      'course. Skip it whenever you like — you can replay it from your Profile page.',
    advance: { kind: 'next' },
    actionLabel: 'Start the tour',
  },
  // Step 2
  {
    id: 'home',
    routes: ['/'],
    target: ['nav-home'],
    sidebar: true,
    title: 'Home',
    body:
      'Your dashboard: the learning you still have to do, what is due soonest, and anything new ' +
      'in your courses.',
    advance: { kind: 'next' },
  },
  // Step 3
  {
    id: 'profile-link',
    routes: ['/'],
    target: ['nav-profile'],
    sidebar: true,
    title: 'Profile',
    body: 'Click Profile to continue.',
    advance: { kind: 'route', to: '/profile' },
  },
  // Step 4
  {
    id: 'profile-card',
    routes: ['/profile'],
    target: ['profile-card'],
    title: 'Your details',
    body: 'Your name, email and ID, as read from your sign-in.',
    guestBody: 'The name and email address this link was sent to.',
    advance: { kind: 'next' },
  },
  // Step 5
  {
    id: 'privacy',
    routes: ['/profile'],
    target: ['privacy-card'],
    title: 'Your data and privacy',
    body:
      'What we hold about you, why, and for how long. You can download a copy of it, or ask ' +
      'for it to be erased, from here.',
    guestBody:
      'What we hold about you, why, and for how long. Because you are here on a link, ask ' +
      'whoever sent it to you if you want your data exported or erased.',
    advance: { kind: 'next' },
  },
  // Step 6
  {
    id: 'learning-link',
    routes: ['/profile'],
    target: ['nav-learning'],
    sidebar: true,
    title: 'Learning',
    body:
      'Every course you have been given, with how far you are through each. A dot appears here ' +
      'when something new is added to one of them.',
    advance: { kind: 'next' },
  },
  // Step 7
  {
    id: 'quizzes-link',
    routes: ['/profile'],
    target: ['nav-quizzes'],
    sidebar: true,
    title: 'Quizzes',
    body: 'Assessments handed to you, and your scores once you have taken them.',
    advance: { kind: 'next' },
  },
  // Step 8
  {
    id: 'sidebar-footer',
    routes: ['/profile'],
    target: ['nav-contact'],
    alsoHighlight: ['theme-toggle', 'nav-logout'],
    sidebar: true,
    title: 'Contact, dark mode and logging out',
    body: 'Contact Us if you need a hand, switch to dark mode, and log out when you are done.',
    guestBody:
      'Contact Us if you need a hand, switch to dark mode, and Leave to close this link when ' +
      'you are done.',
    advance: { kind: 'next' },
  },
  // Step 9
  {
    id: 'tutorial-card',
    routes: ['/', '/learning'],
    target: ['outstanding-tutorial-card', 'learning-tutorial-card'],
    title: 'Your first course',
    body:
      'This is the getting-started course everyone has. Click it to open it — that is how you ' +
      'open any course.',
    advance: { kind: 'route', to: '/learning/:tutorial' },
    // Not on Home when it has already been finished (a replay, say), or when
    // Home could not load: Learning always lists it.
    fallback: {
      target: 'nav-learning',
      body:
        'Every course you have is on the Learning page, including this getting-started one. ' +
        'Click Learning, then click the course marked Start here.',
    },
  },
  // Step 10
  {
    id: 'start-course',
    routes: ['/learning/:tutorial'],
    target: ['start-course-button'],
    title: 'A course page',
    body:
      'Each course opens on a page like this: what it covers, how long it takes, and what is ' +
      'inside. Click the button — Start course, or Continue if you have been here before.',
    advance: { kind: 'route', to: '/learning/:tutorial/content' },
  },
  // Step 11
  {
    id: 'player-rail',
    routes: ['/learning/:tutorial/content'],
    target: ['player-rail'],
    title: 'Course content',
    body:
      'Everything in the course, module by module. A tick shows what you have finished; a ' +
      'padlock means a course must be taken in order and that part is not open yet. Click any ' +
      'open item to jump to it.',
    advance: { kind: 'next' },
  },
  // Step 12
  {
    id: 'player-stage',
    routes: ['/learning/:tutorial/content'],
    target: ['player-stage'],
    title: 'What you are reading',
    body:
      'The item you have open — text, a video, a picture, a PDF, a canvas or a quiz. A section ' +
      'counts as done once you have opened it and answered any quiz inside.',
    advance: { kind: 'next' },
  },
  // Step 13
  {
    id: 'player-step',
    routes: ['/learning/:tutorial/content'],
    target: ['player-prev-next'],
    title: 'Moving through a course',
    body:
      'Previous and Next step through the course in order — so do the ← and → keys on your ' +
      'keyboard. Try it: press Next, or →.',
    advance: { kind: 'signal', name: PLAYER_STEP_SIGNAL },
    // A course with a single item has nowhere to step to, so the buttons are
    // not drawn. Say what they do and move on.
    fallback: {
      body:
        'In a longer course, Previous and Next buttons appear under what you are reading, and ' +
        'the ← and → keys on your keyboard do the same.',
      advance: { kind: 'next' },
    },
  },
  // Step 14
  {
    id: 'player-tabs',
    routes: ['/learning/:tutorial/content'],
    target: ['player-tabs'],
    title: 'Learning tools and Notes',
    body:
      'Notes is where you write things down for yourself. Each note is filed under whatever ' +
      'you have open, and only you can see it. Learning tools is set aside for extra help ' +
      'that is on its way.',
    advance: { kind: 'next' },
  },
  // Step 15
  {
    id: 'done',
    routes: ['/learning/:tutorial/content'],
    title: 'You’re ready',
    body:
      'That is the tour. The rest of the guide is in this getting-started course, so carry on ' +
      'through it when you have a moment. You can replay this tour any time from your Profile ' +
      'page.',
    advance: { kind: 'finish' },
    actionLabel: 'Finish',
  },
];
