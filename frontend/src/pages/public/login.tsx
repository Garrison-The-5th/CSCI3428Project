/**
 * File: login.tsx
 * Description: Login for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import '@/pages/public/login.css';

import { Navigate } from 'react-router-dom';

import logo from '@/assets/logo.svg';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';

const Login = () => {
  // Feature flag: Set to false to disable Google OAuth login button
  const ENABLE_GOOGLE_LOGIN = import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true';

  const { login, authenticated, keycloak } = useAuth();
  const isAdmin = keycloak?.hasResourceRole('admin');

  // If already authenticated, redirect to home
  if (authenticated) {
    return isAdmin ? <Navigate to="/admin" replace /> : <Navigate to="/" replace />;
  }

  const handleGoogleLogin = () => {
    keycloak.login({ idpHint: 'oauth2' });
  };

  return (
    <div
      className="login-screen flex flex-row items-center justify-center min-h-screen w-full bg-navy"
    >
      <div
        className="login-panel z-10 flex-1 flex flex-col justify-center items-center max-w-8/12 p-8"
      >
        <img src={logo} alt="Logo" className="login-logo mb-6" />
        <div className="flex flex-col justify-center items-center w-full max-w-md">
          <p className="login-copy font-medium text-light-gray mb-8 text-center">
            Please log in to see boilerplate dashboard
          </p>
          <div className="flex flex-col items-center justify-center w-full">
            <Button
              onClick={login}
              className="w-full border-2 border-purple bg-purple py-3 px-12 text-light-gray
                hover:bg-navy hover:text-purple"
            >
              Login/Register with Keycloak
            </Button>

            {ENABLE_GOOGLE_LOGIN && (
              <>
                <div className="flex items-center gap-3 w-full my-2">
                  <hr className="flex-1 border-gray-400" />
                  <span className="text-light-gray">OR</span>
                  <hr className="flex-1 border-gray-400" />
                </div>

                <Button
                  onClick={handleGoogleLogin}
                  variant="outline"
                  className="flex w-full max-w-md items-center justify-center border-gray-300
                    bg-white px-6 py-3 text-sm font-medium text-gray-800 shadow-md hover:bg-gray-200
                    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  <svg
                    className="h-6 w-6 mr-2"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      <div
        className="login-background absolute top-0 left-0 w-full h-full z-0 overflow-hidden filter
          blur-lg"
      >
        <svg
          className="absolute top-0 left-32 fill-green"
          width="372"
          height="249"
          viewBox="0 0 372 249"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M149.507 190C102.823 190 33.5071 224.167 4.00706 247.5L0.507065 51.5L213.007 0H370.507C369.98 22.4677 362.213 47.3297 351.507 69.651C318.067 133.66 291.932 162.183 240.507 177C211.007 185.5 180.007 190 149.507 190Z" />
        </svg>
        <svg
          className="absolute top-0 left-0 fill-purple"
          width="373"
          height="403"
          viewBox="0 0 373 403"
          fill=""
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M117 341.5C94 382.5 41.3333 396.167 -1 401.5V-2.5H372C366.333 18.3333 364.6 90.2 299 133C282.215 143.951 255.953 152.272 238 160.5C211.022 172.864 184.371 187.21 170.5 205C157.096 222.192 156.161 232.081 143.5 263C135.387 282.812 125.734 325.931 117 341.5Z" />
        </svg>
        <svg
          className="absolute top-0 left-0 stroke-2 stroke-purple"
          width="418"
          height="352"
          viewBox="0 0 418 352"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M-15 351C129 336.5 417 245.4 417 -3" />
        </svg>
        <svg
          className="absolute bottom-0 -right-1 fill-none"
          width="415"
          height="379"
          viewBox="0 0 415 379"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="400.509"
            cy="400.509"
            r="398.5"
            transform="rotate(-2.81124 400.509 400.509)"
            stroke="url(#paint0_linear_10_18)"
            strokeWidth="4"
          />
          <defs>
            <linearGradient
              id="paint0_linear_10_18"
              x1="9.50559"
              y1="357.119"
              x2="552.761"
              y2="59.4047"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#7BB863" />
              <stop offset="1" stopColor="#737ACB" />
            </linearGradient>
          </defs>
        </svg>
        <svg
          className="absolute bottom-0 right-8 fill-purple"
          width="298"
          height="305"
          viewBox="0 0 298 305"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="226" cy="226" r="225.5" stroke="black" />
        </svg>
        <svg
          className="absolute bottom-0 -right-1 fill-green"
          width="415"
          height="441"
          viewBox="0 0 415 441"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M241.537 243.43C64.7197 306.872 8.38581 330.956 0.537109 440.43H413.537V0.930237C374.361 26.845 343.537 53.4302 331.037 111.43C312.391 179.745 310.037 208.93 241.537 243.43Z" />
        </svg>
      </div>

      {/* <div className="flex-1 flex flex-col justify-center items-center bg-dark-gray p-8 gap-8">
        <img src={logo} alt="Logo" className="mb-6" />
        <h1 className="text-2xl font-semibold text-white">Welcome to Boilerplate</h1>
      </div>
      <div className="flex-1 flex flex-col justify-center items-center p-8">
        <div className="flex flex-col justify-center items-center w-full max-w-md">
          <p className="font-medium text-dark-gray mb-8">
            Please log in to see boilerplate dashboard
          </p>
          <div className="flex flex-col items-center justify-center w-full">
            <button
              onClick={login}
              className="w-full bg-navy text-white font-medium py-3 px-8 border-2 border-navy
                rounded-md hover:bg-white hover:text-navy"
            >
              Login/Register with Keycloak
            </button>

            {ENABLE_GOOGLE_LOGIN && (
              <>
                <div className="flex items-center gap-3 w-full my-2">
                  <hr className="flex-1 border-gray-400" />
                  <span className="text-gray-400">OR</span>
                  <hr className="flex-1 border-gray-400" />
                </div>

                <button
                  onClick={handleGoogleLogin}
                  className="flex items-center justify-center bg-white border border-gray-300
                    rounded-lg shadow-md w-full max-w-md px-6 py-3 text-sm font-medium text-gray-800
                    hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2
                    focus:ring-gray-500"
                >
                  <svg
                    className="h-6 w-6 mr-2"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </button>
              </>
            )}
          </div>

          <div className="flex justify-center mt-8 gap-4">
            <Link to="/public" className={loginLinkStyles}>
              View Public Page
            </Link>
            <Link to="/about" className={loginLinkStyles}>
              About
            </Link>
          </div>
        </div>
      </div> */}
    </div>
  );
};

export default Login;
