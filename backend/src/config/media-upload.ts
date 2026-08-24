/**
 * File: media-upload.ts
 * Description: Upload rules — allow list, content verification and HEIC transcoding.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { Request } from 'express';
import multer from 'multer';

/**
 * Upload rules for course and section media.
 *
 * HEIC is accepted but never stored as-is: Chrome and Firefox cannot render it,
 * so `normalizeUpload` transcodes it to JPEG. PDFs are stored unchanged and are
 * rendered in an embedded viewer rather than as an image.
 */

export const DISPLAYABLE_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
];

/**
 * SVG is deliberately absent.
 *
 * An SVG is a script host: it can carry inline `<script>` and `<foreignObject>`,
 * and uploaded media is served back to learners from a `data:` URI on the app's
 * own origin — so a malicious upload would execute as the application. TTG
 * Technology Standards §3.3.2 requires user-supplied SVG scriptable content to
 * be sanitised, disabled or sandboxed; disabling is what is implemented here.
 *
 * Restoring SVG support means sanitising on write, the same way author rich text
 * is handled in `config/rich-text.ts`, and is tracked as a follow-up rather than
 * left as an unguarded hole. See docs/security-follow-ups.md.
 */
export const REJECTED_IMAGE_TYPES = ['image/svg+xml'];

/** Apple's formats — converted to JPEG on upload. */
export const HEIC_TYPES = [
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];

export const PDF_TYPE = 'application/pdf';

export const ALLOWED_UPLOAD_TYPES = [...DISPLAYABLE_IMAGE_TYPES, ...HEIC_TYPES, PDF_TYPE];

/** Extensions used as a fallback: browsers often send HEIC as a generic type. */
const HEIC_EXTENSIONS = /\.(heic|heif)$/i;

/** Extensions that must never be accepted whatever the declared type says. */
const BLOCKED_EXTENSIONS = /\.(svg|svgz|html?|xhtml|js|mjs|php|exe|sh|bat)$/i;

export function isHeic(file: { mimetype: string; originalname: string }): boolean {
  return (
    HEIC_TYPES.includes(file.mimetype.toLowerCase()) || HEIC_EXTENSIONS.test(file.originalname)
  );
}

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const mimetype = file.mimetype.toLowerCase();

  if (REJECTED_IMAGE_TYPES.includes(mimetype) || BLOCKED_EXTENSIONS.test(file.originalname)) {
    cb(new Error('SVG and script-bearing files are not accepted. Use PNG, JPEG or WebP.'));
    return;
  }

  // Some browsers send HEIC as application/octet-stream, so trust the extension too.
  if (ALLOWED_UPLOAD_TYPES.includes(mimetype) || isHeic(file)) {
    cb(null, true);
    return;
  }

  cb(new Error('Unsupported file type. Allowed: JPEG, PNG, GIF, WebP, BMP, HEIC/HEIF and PDF.'));
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    // One file per request; the API has no multi-upload route, and accepting
    // more would let a single call bypass the per-request size expectation.
    files: 1,
  },
});

export interface NormalizedUpload {
  buffer: Buffer;
  mimeType: string;
  /** PDFs are shown in an embedded viewer, everything else as an image. */
  isPdf: boolean;
}

/**
 * Verifies what a file actually *is*, by reading its magic bytes.
 *
 * §3.8.2 requires files from untrusted sources to be "validated to be of
 * expected type based on the file's content". The declared MIME type and the
 * filename are both attacker-controlled: renaming `payload.svg` to `photo.png`
 * and declaring `image/png` previously sailed through, because nothing ever
 * opened the file.
 *
 * Written in-house rather than pulling in `file-type`, which ships ESM-only and
 * so cannot be required from this CommonJS package without a dynamic import
 * that Jest's runtime then cannot execute. Only seven formats are accepted, so
 * the signatures below are the whole problem — and being synchronous and
 * dependency-free makes them trivially testable.
 *
 * Returns the detected type, or null when the format is not recognised.
 */
export function detectType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
  const ascii = (offset: number, length: number) =>
    buffer.subarray(offset, offset + length).toString('latin1');

  // JPEG — SOI marker followed by any segment.
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';

  // PNG — the 8-byte signature, including the CRLF/EOF trap bytes.
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';

  // GIF — both revisions.
  const gif = ascii(0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';

  // WebP — a RIFF container whose form type is WEBP.
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';

  // BMP.
  if (ascii(0, 2) === 'BM') return 'image/bmp';

  // PDF. The header is allowed a little leading junk by the spec, but every
  // producer worth accepting puts it first.
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';

  /*
   * HEIC/HEIF — an ISO base media file whose brand says so.
   *
   * The box header is a 4-byte length then "ftyp", with the major brand at
   * offset 8. Checking the brand rather than just "ftyp" matters: MP4 and MOV
   * share the same container, and accepting those would let a video through as
   * a photo.
   */
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs'].includes(brand)) {
      return 'image/heic';
    }
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }

  return null;
}

/**
 * Converts HEIC to JPEG so the result displays in every browser, and passes
 * everything else through untouched — after confirming the bytes match the
 * claim on the envelope.
 */
export async function normalizeUpload(file: Express.Multer.File): Promise<NormalizedUpload> {
  const detected = detectType(file.buffer);

  // A format nothing recognises is not a format we are willing to store and
  // serve back. SVG in particular is text, so it has no magic bytes at all and
  // lands here — which is a second, independent reason it cannot get through.
  if (!detected) {
    throw new Error('That file could not be recognised as an image or PDF.');
  }

  if (!ALLOWED_UPLOAD_TYPES.includes(detected)) {
    throw new Error(`That file is actually a ${detected} file, which is not an accepted format.`);
  }

  if (HEIC_TYPES.includes(detected) || isHeic(file)) {
    // Imported lazily so the WASM decoder is only loaded when a HEIC arrives.
    const { default: convert } = await import('heic-convert');
    const output = await convert({
      buffer: new Uint8Array(file.buffer) as unknown as ArrayBufferLike,
      format: 'JPEG',
      quality: 0.9,
    });

    return { buffer: Buffer.from(output), mimeType: 'image/jpeg', isPdf: false };
  }

  // The detected type wins over the declared one from here on, so what is
  // stored and later served always matches the actual bytes.
  return { buffer: file.buffer, mimeType: detected, isPdf: detected === PDF_TYPE };
}
