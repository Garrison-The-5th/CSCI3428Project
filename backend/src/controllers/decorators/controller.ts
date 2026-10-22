/**
 * File: controller.ts
 * Description: Controller for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import 'reflect-metadata';

import { AppRouter } from '@/app-router';
import { MetadataKeys } from '@/controllers/decorators/metadata-keys';
import { Methods } from '@/controllers/decorators/methods';

const router = AppRouter.getInstance();

const isParam = (segment: string) => segment.startsWith(':');

/**
 * Puts literal path segments ahead of parameterised ones.
 *
 * Express matches in registration order, and registration order was previously
 * whatever `Object.getOwnPropertyNames` returned — that is, the order the methods
 * happen to be written in. That made correctness depend on `/courses/manage`
 * being declared above `/courses/:id`: swap them, or sort the class
 * alphabetically, and "manage" silently becomes a course id.
 *
 * Comparing segment by segment removes the trap. `/courses/manage` beats
 * `/courses/:id` because position 1 is a literal against a parameter; routes that
 * cannot shadow each other compare equal and keep their existing order, since
 * Array.prototype.sort is stable.
 */
function byPathSpecificity(a: string, b: string): number {
  const left = a.split('/').filter(Boolean);
  const right = b.split('/').filter(Boolean);

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (isParam(left[index]) !== isParam(right[index])) {
      return isParam(left[index]) ? 1 : -1;
    }
  }

  return 0;
}

/**
 * Class decorator: registers every decorated method of the class on the shared router under
 * `routePrefix`, with its middlewares, most specific paths first.
 */
export function controller(routePrefix: string) {
  return function <T extends abstract new (...args: unknown[]) => unknown>(target: T) {
    const routes = Object.getOwnPropertyNames(target.prototype)
      .map((key) => ({
        handler: target.prototype[key],
        path: Reflect.getMetadata(MetadataKeys.path, target.prototype, key) as string | undefined,
        method: Reflect.getMetadata(MetadataKeys.method, target.prototype, key) as Methods,
        middlewares: Reflect.getMetadata(MetadataKeys.middleware, target.prototype, key) || [],
      }))
      .filter((route): route is typeof route & { path: string } => Boolean(route.path));

    routes.sort((a, b) => byPathSpecificity(a.path, b.path));

    routes.forEach((route) => {
      router[route.method](`${routePrefix}${route.path}`, ...route.middlewares, route.handler);
    });
  };
}
