/**
 * File: contact-us.tsx
 * Description: Contact us for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-09-22
 */
import '@/pages/private/contact-us/contact-us.css';

import { EnvelopeIcon, MapPinIcon, PhoneIcon } from '@heroicons/react/24/outline';
import { type SubmitEvent, useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import HttpHelper from '@/utils/http-helper';

const ContactUs = () => {
  const { user } = useAuth();
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [subscribeEmail, setSubscribeEmail] = useState(user?.email ?? '');
  const [subscribeStatus, setSubscribeStatus] = useState<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setSubscribeEmail(user?.email ?? '');
  }, [user?.email]);

  const iconStyles = 'w-6 h-6';
  const labelContainer = 'flex items-center gap-2';
  const fieldLabel = 'text-center text-lg font-medium';
  const fieldValue = 'mb-6 px-6 text-lg text-text-muted';

  const handleSubscribeSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubscribeStatus(null);

    void (async () => {
      try {
        await HttpHelper.postPublic('auth/subscribe', {
          email: subscribeEmail,
          name: user?.name ?? null,
        });
        setSubscribeStatus({
          message: 'Subscription saved successfully.',
          kind: 'success',
        });
        setIsSubscribeOpen(false);
      } catch (error) {
        setSubscribeStatus({
          message: error instanceof Error ? error.message : 'Failed to save subscription.',
          kind: 'error',
        });
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <div className="page-container flex flex-col">
      <div>
        <h1 className="page-title text-center text-dark-gray font-bold">Get in touch with us!</h1>
      </div>
      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-gray-400" />

      <div className="contact-layout flex flex-col items-center">
        {/* Contact Info */}
        <div className="flex flex-col w-fit mx-auto gap-8 divide-y divide-gray-300">
          <div className="flex flex-col items-center gap-2">
            <div className={labelContainer}>
              <MapPinIcon className={iconStyles} />
              <label className={fieldLabel}>Address</label>
            </div>
            <p className={fieldValue}>
              Telus Sky - 655 Center Street South <br />
              Calgary, Alberta, Canada T2G 1S6
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className={labelContainer}>
              <PhoneIcon className={iconStyles} />
              <label className={fieldLabel}>Phone</label>
            </div>
            <p className={fieldValue}>+1 (403) 690-7006</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className={labelContainer}>
              <EnvelopeIcon className={iconStyles} />
              <label className={fieldLabel}>Email</label>
            </div>
            <p className={fieldValue}>info@ttgteams.com</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsSubscribeOpen(true)}
          className="button2 relative z-10 mx-auto inline-block cursor-pointer overflow-hidden
            rounded-lg border border-gray-100 bg-gray-100 px-[1.7em] py-[0.7em] text-lg
            text-[#090909] transition-all duration-200 ease-in hover:border-green hover:text-white"
        >
          subscribe with email
        </button>

        {subscribeStatus && (
          <p
            className={`mt-4 text-sm font-medium ${
              subscribeStatus.kind === 'success' ? 'text-green' : 'text-destructive'
            }`}
          >
            {subscribeStatus.message}
          </p>
        )}

        <hr className="mt-4 mb-8 h-0.5 w-full border-t-0 bg-gray-400" />

        {/* Business Hours */}
        <Card className="mx-auto max-w-xs border-gray-300 bg-light-gray shadow-xs">
          <CardHeader className="items-center pb-2">
            <CardTitle className="text-xl">Business Hours</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <p>
              <strong>Monday - Friday</strong>
            </p>
            <p>8:00 AM - 4:30 PM MST</p>
          </CardContent>
        </Card>
      </div>

      {isSubscribeOpen && (
        <div
          className="subscribe-modal-backdrop"
          role="presentation"
          onClick={() => setIsSubscribeOpen(false)}
        >
          <Card
            aria-modal="true"
            className="subscribe-modal"
            role="dialog"
            aria-labelledby="subscribe-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="subscribe-modal-header">
              <CardTitle id="subscribe-modal-title">Subscribe with email</CardTitle>
            </CardHeader>

            <CardContent>
              <form className="subscribe-form flex flex-col gap-3" onSubmit={handleSubscribeSubmit}>
                <label htmlFor="subscribe-email">Email</label>
                <Input
                  id="subscribe-email"
                  name="email"
                  type="email"
                  value={subscribeEmail}
                  placeholder="you@example.com"
                  required
                  onChange={(event) => setSubscribeEmail(event.target.value)}
                />

                <button type="submit" className="subscribe-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Subscribe'}
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ContactUs;
