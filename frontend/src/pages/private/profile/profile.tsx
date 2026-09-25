/**
 * File: profile.tsx
 * Description: The learner’s own details, and the privacy and data controls that go with them.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import '@/pages/private/profile/profile.css';

import { EnvelopeIcon, FingerPrintIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import PrivacyNotice from '@/components/common/privacy-notice';
import ToastNotification from '@/components/common/toast-notification';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';

const Profile = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  /**
   * Export and erasure report through a toast.
   *
   * The notice can say so itself where it is given a handler, and here it should
   * be: both of its buttons take seconds and finish silently, so without one an
   * export that failed and an export that worked look identical.
   */
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>(
    { show: false, message: '', type: 'success' },
  );

  useEffect(() => {
    // Simulate loading time for user data
    const timer = setTimeout(() => {
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const profileContainer = 'page-container flex flex-col m-0';
  const iconStyles = 'w-6 h-6';
  const labelContainer = 'flex items-center gap-2';
  const fieldLabel = 'text-lg font-medium';
  const fieldValue = 'mt-2  pl-8 text-lg text-text-muted';

  if (loading) {
    return (
      <div className={profileContainer}>
        <div className="flex flex-row gap-2 justify-center items-center mt-12">
          <svg
            aria-hidden="true"
            className="w-8 h-8 text-white animate-spin fill-green"
            viewBox="0 0 100 101"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
              fill="currentColor"
            />
            <path
              d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
              fill="currentFill"
            />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className={profileContainer}>
      <h1 className="page-title font-bold text-dark-gray">Profile</h1>
      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-gray-400" />

      <Card className="responsive-panel bg-light-gray">
        <CardContent className="flex flex-col gap-8 divide-y divide-gray-300 px-6 py-8">
          <div>
            <div className={labelContainer}>
              <UserCircleIcon className={iconStyles} />
              <label className={fieldLabel}>Full Name</label>
            </div>
            <p className={`${fieldValue} mb-6`}>{user?.name || 'Not Provided'}</p>
          </div>
          <div>
            <div className={labelContainer}>
              <EnvelopeIcon className={iconStyles} />
              <label className={fieldLabel}>Email</label>
            </div>
            <p className={`${fieldValue} mb-6`}>{user?.email || 'Not Provided'}</p>
          </div>
          <div>
            <div className={labelContainer}>
              <FingerPrintIcon className={iconStyles} />
              <label className={fieldLabel}>User ID</label>
            </div>
            <p className={fieldValue}>{user?.sub || 'Not Available'}</p>
          </div>
        </CardContent>
      </Card>

      {/*
        Privacy and data, moved here from Contact us.

        It was on the contact page because that is somewhere a learner already
        goes with a question, which put it next to a subscribe form and a list of
        business hours. This is where somebody comes to look at what the platform
        holds about them, so it is where "what we hold, and how to take it away"
        belongs — the two halves of §3.5.3 sitting under the three fields they
        are about.
      */}
      <div className="responsive-panel mt-8">
        <PrivacyNotice
          onNotify={(message, type = 'success') => setToast({ show: true, message, type })}
        />
      </div>

      <ToastNotification
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((current) => ({ ...current, show: false }))}
      />
    </div>
  );
};

export default Profile;
