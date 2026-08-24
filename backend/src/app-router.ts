/**
 * File: app-router.ts
 * Description: App router for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
// AppRouter creates and manages a single, shared router instance for the whole
// application.
import express from 'express';

export class AppRouter {
  private static instance: express.Router;

  static getInstance(): express.Router {
    if (!AppRouter.instance) {
      AppRouter.instance = express.Router();
    }
    return AppRouter.instance;
  }
}
