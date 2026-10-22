/**
 * File: public-page.tsx
 * Description: Public page for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** The public landing page shown before signing in. */
const PublicPage = () => {
  const navigate = useNavigate();

  return (
    <div className="page-container w-full text-center py-12 mx-auto">
      <Card>
        <CardContent className="py-12">
          <h1 className="page-title mb-4 text-dark-gray">Public Page</h1>
          <p className="page-subtitle text-navy mb-2">
            This page is accessible without authentication.
          </p>
          <p className="page-subtitle text-navy mb-2">Anyone can view this content.</p>
        </CardContent>
      </Card>

      <Button onClick={() => navigate(-1)} className="mt-12 bg-green text-white hover:bg-green/90">
        ← Back
      </Button>
    </div>
  );
};

export default PublicPage;
