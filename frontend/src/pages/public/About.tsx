/**
 * File: about.tsx
 * Description: About for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import '@/pages/public/about.css';

import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="page-container w-full text-center py-12 mx-auto">
      <h1 className="page-title mb-4 text-dark-gray">About This Boilerplate</h1>{' '}
      <p className="page-subtitle text-navy mb-2">
        A clean React TypeScript boilerplate with Keycloak authentication.{' '}
      </p>
      <Card className="about-content mt-8 ml-8">
        <CardHeader>
          <CardTitle className="section-title text-start text-dark-gray">Features:</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-inside list-disc pl-6 text-start leading-6 text-dark-gray">
            <li>React 19 + TypeScript</li>
            <li>Keycloak Authentication</li>
            <li>Protected & Public Routes</li>
            <li>Context API for State Management</li>
            <li>Clean Architecture</li>
          </ul>
        </CardContent>
      </Card>
      <Button onClick={() => navigate(-1)} className="mt-12 bg-green text-white hover:bg-green/90">
        ← Back
      </Button>
    </div>
  );
};

export default About;
