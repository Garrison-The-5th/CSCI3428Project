/**
 * File: content-type.ts
 * Description: Rejects request bodies that are not the content type this API accepts.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { NextFunction, Request, Response } from 'express';

/**
 * §3.9.2 requires REST services to "explicitly check the incoming Content-Type
 * to be the expected one", and §3.9.1 requires unexpected or missing content
 * types to be refused with 406 or 415.
 *
 * Only requests that actually carry a body are checked. A GET or DELETE has
 * nothing to describe, and demanding a Content-Type on those would break every
 * ordinary read.
 *
 * `multipart/form-data` is allowed through because uploads legitimately use it;
 * multer validates those separately and far more strictly.
 */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function enforceJsonContentType(req: Request, res: Response, next: NextFunction) {
  if (!BODY_METHODS.has(req.method)) return next();

  // A body-less POST is legitimate — several routes act purely on their URL,
  // such as publishing a course or revoking a link.
  const hasBody =
    req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0';
  const isChunked = req.headers['transfer-encoding'] !== undefined;
  if (!hasBody && !isChunked) return next();

  const contentType = req.headers['content-type'];
  if (!contentType) {
    return res
      .status(415)
      .send({ errorMessage: 'A Content-Type header is required for requests with a body.' });
  }

  const mediaType = contentType.split(';')[0]!.trim().toLowerCase();
  const accepted = mediaType === 'application/json' || mediaType === 'multipart/form-data';

  if (!accepted) {
    return res
      .status(415)
      .send({ errorMessage: 'Unsupported Media Type. This API accepts application/json.' });
  }

  return next();
}
