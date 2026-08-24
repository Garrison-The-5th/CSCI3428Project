# UX/UI Design Document

Navigation paths per access level, and the design reasoning behind each page.

Satisfies TTG Technology Standards §2.1.1 (a navigation path diagram per access
level), §2.1.2 (onboarding), §2.1.3 (navigation method, with Design
Justification and Alternatives Considered per page) and §2.2 (colour palette).

---

## 1. Access levels

Three audiences share one application. They differ in what the API returns, not
in which app they load.

| | Signed-in learner | Author / admin | Guest on a link |
|---|---|---|---|
| Enters via | Keycloak | Keycloak | `/a/<token>` |
| Sees | published courses assigned to them | everything, drafts included | only the one item that link was issued for |
| Sidebar | Home, Profile, Learning, Quizzes, Contact | + authoring and admin items | learner items only |

---

## 2. Navigation path diagrams

### 2.1 Signed-in learner

```
                        ┌──────────────┐
   not signed in ──────▶│  /login      │
                        └──────┬───────┘
                               │ Keycloak
                               ▼
                        ┌──────────────┐      ┌────────────────┐
                        │  /  (Home)   │─────▶│ /profile       │
                        │  dashboard   │      └────────────────┘
                        └──┬────────┬──┘
             progress ring │        │ outstanding quiz
                           ▼        ▼
                  ┌────────────┐  ┌──────────────┐
                  │ /learning  │  │ /quizzes     │
                  │ course grid│  │ course grid  │
                  └──────┬─────┘  └──────┬───────┘
                         │ pick a card   │ pick a card
                         ▼               ▼
              ┌────────────────────┐  ┌────────────────────┐
              │ /learning/:id      │  │ /quizzes/:id       │
              │ course overview    │  │ quiz landing       │
              └──────┬─────────────┘  └──────┬─────────────┘
                     │ "Course content"      │ "Start quiz"
                     ▼                       ▼
       ┌──────────────────────────┐  ┌──────────────────────────────┐
       │ /learning/:id/content    │  │ /quizzes/:id/take/:quizId    │
       │ player: stage + rail     │  │ quiz player + rail           │
       │ ← → step through course  │  │ timed, server-anchored       │
       └──────────────────────────┘  └──────────────────────────────┘

                        ┌──────────────┐
   always available ───▶│ /contact     │  contact details, subscribe,
                        │              │  privacy notice + data export
                        └──────────────┘
```

### 2.2 Author / admin

```
                        ┌──────────────┐
                        │  /  (Home)   │   same learner dashboard
                        └──────┬───────┘
                               │ sidebar (authoring section)
        ┌──────────────────────┼──────────────────────┬──────────────┐
        ▼                      ▼                      ▼              ▼
┌────────────────┐  ┌──────────────────┐  ┌────────────────┐ ┌──────────────┐
│ /admin/learning│  │ /admin/quizzes   │  │ /admin/users   │ │ /admin       │
│ lesson library │  │ quiz authoring   │  │ (admin only)   │ │ dashboard    │
└───────┬────────┘  └────────┬─────────┘  └────────────────┘ └──────┬───────┘
        │ pick a card        │ pick a lesson                        │ ?tab=
        ▼                    ▼                          ┌───────────┼───────────┐
┌──────────────────────────────────┐                    ▼           ▼           ▼
│ /admin/learning/:courseId        │            ┌────────────┐ ┌─────────┐ ┌────────┐
│ course editor — six panes:       │            │ assigned   │ │ student │ │ trash  │
│  landing · modules · access      │            │ learning   │ │ insights│ │ bin    │
│  versions · 2 live previews      │            └─────┬──────┘ └────┬────┘ └────────┘
└──────────────────────────────────┘                  │ card        │ learner
                                                      ▼             ▼
                                              ┌────────────┐ ┌──────────────┐
                                              │ roster +   │ │ their courses│
                                              │ assign     │ │ → one course │
                                              └────────────┘ └──────────────┘

Contributors (named on individual courses, not global authors) get
/admin/course-editor instead of the two Create items — the same editor, listing
only the courses they are named on.
```

### 2.3 Guest on an assignment link

```
   email link
       │
       ▼
┌──────────────────┐   valid    ┌──────────────┐
│ /a/<token>       │───────────▶│  /  (Home)   │  same dashboard, scoped
│ validates token, │            └──────┬───────┘  to what was assigned
│ starts session   │                   │
└────────┬─────────┘            ┌──────┴───────┐
         │ invalid              ▼              ▼
         ▼                ┌───────────┐  ┌───────────┐
┌──────────────────────┐  │ /learning │  │ /quizzes  │
│ explains which of    │  └─────┬─────┘  └─────┬─────┘
│ five things is wrong │        ▼              ▼
│ (not valid, revoked, │   course pages    quiz pages
│  expired, idle,      │   (identical to the learner's)
│  sign in instead)    │
└──────────────────────┘   No admin or authoring routes: ProtectedRoute
                           redirects a guest away from all of them.
```

---

## 3. Navigation method

**A left sidebar, fixed order, collapsible.**

**Design justification.** The item set differs by audience but its *order* never
does — Home, Profile, Learning, Quizzes, then authoring, then admin, with
Contact last. Items a person cannot reach are omitted rather than reordered or
disabled, so someone who gains the author role sees new items appear in place
rather than the whole menu rearranging. A sidebar also scales to the eight items
an admin sees, where a top bar would wrap or need a menu.

**Alternatives considered.**

- *Top navigation bar.* Rejected: eight items plus a product name does not fit
  comfortably at tablet width, and it would have needed an overflow menu that
  hides exactly the admin items that are hardest to find.
- *Disabled items for roles you lack.* Rejected: it advertises functionality to
  people who cannot use it and invites support questions. Omission is quieter.
- *Icon-only rail.* Rejected as a default; the sidebar collapses to one on
  demand, which gives the same screen space without making first-time users
  decode pictograms.

---

## 4. Design justification per page

### Home (dashboard)

Outstanding courses render as a horizontally scrolling rail of progress rings;
due dates sit in a right-hand column, soonest first.

*Justification.* Someone with a dozen assignments should scroll sideways through
them rather than push everything else off the screen. Each card is exactly as
wide as its ring so the row reads as a row of rings, and a long title wraps
inside that width instead of stretching the card.

*Alternatives considered.* A wrapping grid — rejected, it pushed due dates below
the fold for anyone with more than six courses. A table — rejected, it made
"how far am I" a number to read rather than a shape to glance at.

### Learning grid

Portrait cards, cover photo on top, counts along the bottom, searchable across
title, description, tags **and** section names.

*Justification.* Someone hunting for "manual handling" is as likely to remember
a section name as the course's own wording; a search that reads only titles fails
quietly for them.

*Alternatives considered.* A list view — rejected, cover photos are the fastest
recognition cue and a list wastes them.

### Course player

Fixed-height stage on the left, content rail on the right, prev/next plus arrow
keys.

*Justification.* Every item plays in a stage of the same height so moving
between a paragraph, an image and a video never resizes the page or pushes the
notes tab off screen. Arrow keys are bound to the window rather than a focused
element, so they work wherever attention is — and are suppressed while typing,
where a note needs its own arrow keys far more than the rail does.

*Alternatives considered.* Letting each item size itself — rejected, the page
jumped on every step. A modal player — rejected, it hid the rail, which is the
main way people orient themselves in a long course.

### Course editor

Six panes behind a sidebar; everything auto-saves; two panes render the real
learner pages as previews.

*Justification.* Auto-save removes the "did I save?" question entirely, which
matters most in the pane where authors spend longest. The previews render the
actual learner components rather than a mock-up, so what an author checks cannot
drift from what ships.

*Alternatives considered.* Explicit save buttons — rejected, an editor with
thirty fields makes save-state a constant background worry. A separate preview
route — rejected, it lost the author's place in the editor.

### Structure editor

Drag-and-drop for modules and sections; numbers are derived, never typed.

*Justification.* Section `2.3` *means* "third section of the second module". Once
that is true, a free-text number field can only ever disagree with reality, so
the field is read-only and dragging is the way to renumber. The UI renumbers
optimistically so numbers change under the cursor rather than a round trip later.

*Alternatives considered.* Editable number fields — rejected, they permitted
duplicates and gaps that then had to be validated and explained. Up/down arrows —
kept as a possible accessibility fallback; drag-and-drop alone is a known gap
for keyboard-only users.

### Admin dashboard

Three panes, with the open pane in the URL (`?tab=`).

*Justification.* A link to the recycle bin should be a link to the recycle bin,
not to whatever the dashboard opens on.

*Alternatives considered.* Three separate routes — rejected, it triplicated the
shell and the toast handling for no gain.

### Assignment roster

One shared component, used by both the course editor and the admin dashboard.

*Justification.* "What can be done to an assignment" is a single question and
should have a single answer wherever it is asked. Two implementations would
drift within a release.

---

## 5. Onboarding (§2.1.2)

**Current state: not implemented.** There is no demo mode and no guided tour.

What softens it today: assignment emails link straight to the item rather than
to a home page, empty states explain what to do next ("No lessons yet. Create
one above to get started"), and the guest flow drops someone directly onto the
dashboard with only their own work on it.

**Recommended.** A first-run tour of the four sidebar destinations for learners,
and a separate one for the course editor's six panes — the densest screen in the
product. Tracked as a gap rather than claimed as done.

---

## 6. Colour palette (§2.2)

The application uses the **TTG palette** from §2.2.1:

| Token | Hex | Use |
|---|---|---|
| `--color-navy` | `#153243` | Primary — buttons, headings, active nav |
| `--color-green` | `#7BB863` | Success, progress, completion ticks |
| `--color-purple` | `#737ACB` | Accent |
| white | `#FFFFFF` | Surfaces |
| `--color-dark-gray` | `#333333` | Body text |

All three brand values match §2.2.1 exactly. Tokens live in
`frontend/src/index.css`, with light and dark variants.

> **Open question.** This project sits in a directory named `FEC`. If it is an
> FEC product rather than a TTG one, §2.2.2 requires `#FA036B`, `#FF6A97`,
> `#634b55` and `#2b161b` instead. The change is contained — the tokens are in
> one file — but it also touches the `#5b9748` green used inline in about a
> dozen components. Confirm before release.

---

## 7. Responsive design (§2.3)

Tailwind's breakpoints, which line up with the standard's bands: `sm` 640px,
`md` 768px, `lg` 1024px, `xl` 1280px. Layouts use fluid grids and flexbox
throughout, images carry `max-width`, and the viewport meta tag is set in
`index.html`.

## 8. Testing and iteration (§2.7)

**Not yet done.** No usability testing, no SUS scoring, no A/B testing. The
standard treats these as practices to apply where suitable; for an internal
compliance tool with a captive audience, a single moderated round with three
authors and three learners would be worth more than any amount of A/B testing,
and is the recommended first step.
