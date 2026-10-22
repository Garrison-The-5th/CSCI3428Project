/**
 * File: admin-page.tsx
 * Description: Admin dashboard.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * AdminPage - admin dashboard.
 *
 * A sidebar switches between the two things an admin comes here for: what has
 * been handed out and how it is going, and what has been deleted. The shell owns
 * the toast so both panes report through one place; each pane owns its own data.
 *
 * Which pane is open lives in the URL (?tab=), so a link to the recycle bin is a
 * link to the recycle bin rather than to whatever the dashboard opens on.
 */
import { Squares2X2Icon, TrashIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import ToastNotification from '@/components/common/toast-notification';
import AssignedLearning from '@/pages/private/admin-page/assigned-learning';
import StudentInsights from '@/pages/private/admin-page/student-insights';
import TrashBin from '@/pages/private/admin-page/trash-bin';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };
type Pane = 'assigned' | 'students' | 'trash';

const PANES: Array<{ key: Pane; label: string; hint: string; Icon: typeof TrashIcon }> = [
  {
    key: 'assigned',
    label: 'Assigned learning',
    hint: 'Who has what, and how far they have got',
    Icon: Squares2X2Icon,
  },
  {
    key: 'students',
    label: 'Student insights',
    hint: 'Each learner and their progress through what they hold',
    Icon: UsersIcon,
  },
  {
    key: 'trash',
    label: 'Trash bin',
    hint: 'Deleted content, restorable for a while',
    Icon: TrashIcon,
  },
];

/** The admin dashboard: one pane at a time, chosen by the `pane` URL parameter. */
const AdminPage = () => {
  const [params, setParams] = useSearchParams();
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });

  const requested = params.get('tab');
  const pane: Pane =
    requested === 'trash' ? 'trash' : requested === 'students' ? 'students' : 'assigned';

  // `replace` so flicking between tabs does not fill up the back button.
  const openPane = (next: Pane) => setParams({ tab: next }, { replace: true });

  /** Shows a toast. */
  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ show: true, message, type });

  const active = PANES.find((entry) => entry.key === pane)!;

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Admin Dashboard</h1>
        <p className="page-subtitle text-dark-gray font-medium">{active.hint}.</p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav className="h-fit md:sticky md:top-20">
          <ul className="flex flex-col gap-1">
            {PANES.map(({ key, label, Icon }) => (
              <li key={key}>
                <button
                  onClick={() => openPane(key)}
                  aria-current={pane === key ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm
                  font-medium transition-colors
                  ${pane === key ? 'bg-navy text-white' : 'text-dark-gray hover:bg-light-gray'}`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {pane === 'assigned' && <AssignedLearning onNotify={notify} />}
          {pane === 'students' && <StudentInsights onNotify={notify} />}
          {pane === 'trash' && <TrashBin onNotify={notify} />}
        </div>
      </div>

      <ToastNotification
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
};

export default AdminPage;
