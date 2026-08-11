/**
 * File: index.tsx
 * Description: Entry point — mounts the provider stack and the app.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import '@/index.css';

// import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app';
import { AuthProvider } from '@/contexts/auth-context';
import { EditorAccessProvider } from '@/contexts/editor-access-context';
import { GuestProvider } from '@/contexts/guest-context';
import { NewContentProvider } from '@/contexts/new-content-context';

createRoot(document.getElementById('root')!).render(
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
);
