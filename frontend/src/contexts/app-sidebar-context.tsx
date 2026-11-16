/**
 * File: app-sidebar-context.tsx
 * Description: Lets a page ask the app shell to tuck its main sidebar away for a while.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
/**
 * Focus mode for the app's main sidebar.
 *
 * The course editor's Modules tab is the one place that wants the whole width
 * of the window: an outline on the left, an editor on the right, and two menus
 * beside them is one menu too many. So that tab asks for the main sidebar to be
 * closed while it is open.
 *
 * "Asks" is the point. The shell owns the sidebar and the person's own choice
 * about it; a page only says "focus on" or "focus off". While focus is on the
 * sidebar starts closed, and the toggle still works, but nothing done in that
 * time touches what the person had chosen before — turning focus off puts the
 * sidebar back exactly as they left it.
 *
 * Outside a provider (a component test, a page rendered on its own) the hook
 * hands back a no-op, so nothing has to guard against there being no shell.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface AppSidebar {
  /** Close the main sidebar for now (`true`), or go back to the person's own choice (`false`). */
  setFocusMode: (focused: boolean) => void;
}

const NO_SHELL: AppSidebar = { setFocusMode: () => {} };

export const AppSidebarContext = createContext<AppSidebar>(NO_SHELL);

/** The app shell's sidebar focus control. A no-op when there is no shell around. */
export const useAppSidebar = (): AppSidebar => useContext(AppSidebarContext);

/**
 * A sidebar's open state, with a temporary override laid over a lasting choice.
 *
 * Shared by the two menus that do this — the app's main sidebar and the course
 * editor's — so they follow one rule: the override wins while it is set, the
 * toggle moves whichever of the two is in charge, and clearing the override
 * shows the lasting choice again, untouched.
 *
 * Pure, so the rule can be tested without rendering either menu.
 */
export interface OverridableChoice {
  /** What the person chose, and what is remembered. */
  choice: boolean;
  /** Set while something is temporarily in charge; null when nothing is. */
  override: boolean | null;
}

/** What is actually shown: the override while there is one, otherwise the choice. */
export function effectiveChoice({ choice, override }: OverridableChoice): boolean {
  return override ?? choice;
}

/**
 * Flips whichever value is in charge. Only a flip of `choice` is worth
 * remembering, which is what `persist` reports.
 */
export function toggleChoice(state: OverridableChoice): OverridableChoice & { persist: boolean } {
  return state.override === null
    ? { choice: !state.choice, override: null, persist: true }
    : { choice: state.choice, override: !state.override, persist: false };
}

/**
 * The app shell's sidebar state.
 *
 * Two values: what the person chose, and a temporary override laid over it
 * while a page has asked for focus. The override starts the sidebar closed, and
 * everything that moves the sidebar in that time moves the override — so the
 * person's own choice is exactly where they left it when the page lets go.
 *
 * A hook rather than state written out in App, so the rule can be exercised on
 * its own without standing up the whole shell.
 */
export function useAppSidebarState() {
  const [state, setState] = useState<OverridableChoice>({ choice: true, override: null });

  /** Opens or closes the sidebar. */
  const toggleSidebar = useCallback(
    () =>
      setState((prev) => {
        const { choice, override } = toggleChoice(prev);
        return { choice, override };
      }),
    [],
  );

  /**
   * Sets the sidebar outright — the walkthrough opens it for the steps about
   * the menu. It works during focus too, so a tour step is never left pointing
   * at a sidebar that a page has closed.
   */
  const setSidebar = useCallback(
    (open: boolean) =>
      setState((prev) =>
        prev.override === null ? { ...prev, choice: open } : { ...prev, override: open },
      ),
    [],
  );

  /** What pages are handed: focus on closes the sidebar for now, focus off restores the choice. */
  const appSidebar = useMemo<AppSidebar>(
    () => ({
      setFocusMode: (focused: boolean) =>
        setState((prev) => {
          // Asking for what is already so must not re-close a sidebar the
          // person has just opened inside the focused page.
          if (focused === (prev.override !== null)) return prev;
          return { ...prev, override: focused ? false : null };
        }),
    }),
    [],
  );

  return { sidebarOpen: effectiveChoice(state), toggleSidebar, setSidebar, appSidebar };
}
