/**
 * File: index.tsx
 * Description: Entry point — loads the sign-in settings, then mounts the provider stack and the app.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import '@/index.css';

// import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app';
import { AuthProvider } from '@/contexts/auth-context';
import { EditorAccessProvider } from '@/contexts/editor-access-context';
import { GuestProvider } from '@/contexts/guest-context';
import { NewContentProvider } from '@/contexts/new-content-context';
import { loadKeycloak } from '@/utils/keycloak';
import { logger } from '@/utils/logger';

const root = createRoot(document.getElementById('root')!);

// The Keycloak client is configured from the backend (GET /auth-config), so it
// has to exist before anything that signs in or calls the API renders.
loadKeycloak()
  .then(() =>
    root.render(
      // optional to use StrictMode - dev tool only
      // <StrictMode>
      <AuthProvider>
        {/* Guests arrive on an assignment link and use the app without Keycloak. */}
        <GuestProvider>
          {/* Course-level edit rights, derived from the courses they are named on. */}
          <EditorAccessProvider>
            {/* One read of "what is new" for the whole shell — sidebar and pages. */}
            <NewContentProvider>
              <App />
            </NewContentProvider>
          </EditorAccessProvider>
        </GuestProvider>
      </AuthProvider>,
      // </StrictMode>,
    ),
  )
  .catch((error) => {
    logger.error('could not load sign-in settings', error);
    root.render(
      <p style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        The learning platform could not start. Please refresh the page in a moment.
      </p>,
    );
  });
