/**
 * File: use.ts
 * Description: Use for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import 'reflect-metadata';

import { RequestHandler } from 'express';

import { MetadataKeys } from '@/controllers/decorators/metadata-keys';

/**
 * Method decorator that adds a middleware to a route. Decorators apply bottom-up, so the `@use`
 * written lowest runs first — which is why `authenticateAndAttachUser` always sits at the bottom.
 */
export function use(middleware: RequestHandler) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function (target: object, key: string, desc: PropertyDescriptor) {
    const middlewares = Reflect.getMetadata(MetadataKeys.middleware, target, key) || [];
    Reflect.defineMetadata(MetadataKeys.middleware, [...middlewares, middleware], target, key);
  };
}
