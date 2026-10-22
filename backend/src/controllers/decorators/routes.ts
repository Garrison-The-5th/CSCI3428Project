/**
 * File: routes.ts
 * Description: Routes for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import 'reflect-metadata';

import { MetadataKeys } from '@/controllers/decorators/metadata-keys';
import { Methods } from '@/controllers/decorators/methods';

/**
 * Builds a method decorator (`@get`, `@post`, …) that records the HTTP verb and path for
 * `@controller` to register.
 */
function routeBinder(method: string) {
  return function (path: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return function (target: object, key: string, desc: PropertyDescriptor) {
      Reflect.defineMetadata(MetadataKeys.path, path, target, key);
      Reflect.defineMetadata(MetadataKeys.method, method, target, key);
    };
  };
}

export const get = routeBinder(Methods.get);
export const put = routeBinder(Methods.put);
export const post = routeBinder(Methods.post);
export const del = routeBinder(Methods.del);
export const patch = routeBinder(Methods.patch);
