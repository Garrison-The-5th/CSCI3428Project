/**
 * File: navbar.tsx
 * Description: Navbar for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-09-22
 */
import '@/components/navbar/navbar.css';

import { MoonIcon } from '@heroicons/react/24/outline';
import * as React from 'react';
import { NavLink } from 'react-router-dom';

import LogoImage from '@/assets/logo.svg';
import { useGuest } from '@/contexts/guest-context';
import { useNewContent } from '@/contexts/new-content-context';
import { getLogoutItem } from '@/utils/get-navbar-data';
import { keycloak } from '@/utils/keycloak';

type NavbarProps = {
  isDarkMode: boolean;
  pages: Page[];
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  toggleTheme: () => void;
};

interface Page {
  text: string;
  path?: string;
  Icon?: React.ComponentType;
}

/**
 * The unread mark.
 *
 * Carries a label rather than being decoration only: a coloured dot means
 * nothing to a screen reader, and "there is new content" is the entire message.
 */
const NewDot = () => (
  <span
    className="ml-auto flex h-2.5 w-2.5 shrink-0 rounded-full bg-danger"
    role="status"
    aria-label="New content"
    title="New content"
  />
);

const NavItem = ({
  item,
  onClick,
  showDot = false,
  exact = false,
}: {
  item: Page;
  onClick?: () => void;
  /** Puts an unread mark on the item — used for new course content. */
  showDot?: boolean;
  /**
   * Light only on this exact path, rather than on everything beneath it.
   *
   * Set for an item that has another item nested under it — see `isPrefixOfAnother`.
   */
  exact?: boolean;
}) => {
  const Icon = item.Icon;

  const baseClass =
    'flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors duration-150';

  if (onClick) {
    return (
      <li>
        <button onClick={onClick} className={`group hover:bg-white/10 ${baseClass}`}>
          {Icon && (
            <span
              className="w-6 h-6 flex items-center justify-center text-text-secondary
                group-hover:text-danger"
            >
              <Icon />
            </span>
          )}
          <span className="text-text-secondary font-medium group-hover:text-danger">
            {item.text}
          </span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.path ?? '/'}
        end={exact}
        className={({ isActive }) =>
          `group ${baseClass}
          ${isActive ? 'text-green bg-green/20 cursor-default' : 'text-text-secondary hover:bg-white/10'}`
        }
      >
        {Icon && (
          <span className="w-6 h-6 flex items-center justify-center group-hover:text-green">
            <Icon />
          </span>
        )}
        <span className="font-medium group-hover:text-green">{item.text}</span>
        {showDot && <NewDot />}
      </NavLink>
    </li>
  );
};

/**
 * Whether another item in the rail sits underneath this one.
 *
 * A tab has to stay lit while the user is inside what it led them to: opening a
 * course from Home lands on /learning/:courseId, and a tab that only matched its
 * own path went dark exactly when the learner was most plainly in their
 * learning. So an item lights for its whole subtree — unless another tab lives
 * in that subtree, because then the deeper tab is the honest answer and lighting
 * both would say the user is in two places. "/" is the prefix of everything, so
 * Home is always exact by this rule, and so is /admin while /admin/users exists.
 */
function isPrefixOfAnother(path: string, pages: Page[]): boolean {
  if (path === '/') return true;
  return pages.some(
    (other) => (other.path ?? '') !== path && (other.path ?? '').startsWith(`${path}/`),
  );
}

const Navbar: React.FC<NavbarProps> = ({
  isDarkMode,
  pages,
  sidebarOpen,
  toggleSidebar,
  toggleTheme,
}) => {
  const logoutItem = getLogoutItem();
  const { isGuest, endSession } = useGuest();
  const { hasNewContent } = useNewContent();

  return (
    <>
      {/* Top AppBar */}
      <header
        className="app-header fixed flex items-center w-full top-0 z-40 bg-navbar-bg h-16 px-4 gap-3
          shadow-md/40"
      >
        <button
          onClick={(e) => {
            toggleSidebar();
            e.currentTarget.blur();
          }}
          className="p-2 rounded-lg text-white hover:bg-white/10 hover:text-green transition-colors
            duration-150 focus:outline-none"
          aria-label="Toggle sidebar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>

        <NavLink to="/" className="flex items-center min-w-0">
          <img src={LogoImage} alt="TTG Logo" className="h-10" />
        </NavLink>
      </header>

      {/* Sidebar */}
      <aside
        className={`app-sidebar fixed top-16 left-0 z-40 h-[calc(100vh-4rem)] w-64 bg-navbar-bg flex
          flex-col transition-transform duration-300 ease-in-out ${
            sidebarOpen
              ? `translate-x-0
                shadow-[4px_4px_6px_-1px_rgba(0,0,0,0.1),2px_2px_4px_-2px_rgba(0,0,0,0.1)]`
              : '-translate-x-full'
          } `}
      >
        <nav className="flex flex-col h-full">
          {/* Main nav pages */}
          <ul className="px-3 py-4 space-y-1">
            {pages.map((page) => (
              <NavItem
                key={page.text}
                item={page}
                // New content always lives inside a course, so Learning is the
                // one tab the mark can point at without being vague.
                showDot={page.path === '/learning' && hasNewContent}
                exact={isPrefixOfAnother(page.path ?? '/', pages)}
              />
            ))}
          </ul>

          {/* Divider */}
          <hr className="mt-auto mb-2 mx-4 h-0.5 border-t-0 bg-gray-600" />

          {/* Theme toggle */}
          <div className="px-3 pt-4">
            <button
              aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
              aria-pressed={isDarkMode}
              className="theme-toggle flex w-full items-center justify-between rounded-lg px-4 py-3
                text-text-secondary transition-colors duration-150 hover:bg-white/10
                hover:text-green"
              onClick={toggleTheme}
              type="button"
            >
              <span className="flex items-center gap-3 font-medium">
                <MoonIcon className="size-6" />
                Dark mode
              </span>
              <span
                className={`theme-toggle__track ${isDarkMode ? 'theme-toggle__track--active' : ''}`}
                aria-hidden="true"
              >
                <span className="theme-toggle__thumb" />
              </span>
            </button>
          </div>

          {/* Logout — a guest has no Keycloak session, just the assignment token */}
          <ul className="px-3 py-4">
            <NavItem
              item={isGuest ? { ...logoutItem, text: 'Leave' } : logoutItem}
              onClick={() => {
                if (isGuest) {
                  endSession();
                  window.location.assign('/');
                  return;
                }
                keycloak.logout({ redirectUri: window.location.origin });
              }}
            />
          </ul>
        </nav>
      </aside>
    </>
  );
};

export default Navbar;
