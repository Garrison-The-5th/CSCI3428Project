/**
 * File: utils.ts
 * Description: API base URL resolution and the Tailwind class merge helper.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { logger } from '@/utils/logger';

// Determine if we are in development mode
const isDevelopment =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '0.0.0.0';

export const API_BASE_URL = isDevelopment
  ? 'http://localhost:5002' // Development: use Docker's mapped port
  : '/api'; // Production: relative path

// Log only in development
if (isDevelopment) {
  logger.debug('Development mode - API_BASE_URL:', API_BASE_URL);
}

/** Joins class names, letting later Tailwind classes override conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
