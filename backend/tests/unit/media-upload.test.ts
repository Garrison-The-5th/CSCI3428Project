/**
 * File: media-upload.test.ts
 * Description: Unit tests for upload filtering and content-based type
 *   verification.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import {
  ALLOWED_UPLOAD_TYPES,
  detectType,
  isHeic,
  MAX_UPLOAD_BYTES,
  normalizeUpload,
  REJECTED_IMAGE_TYPES,
} from '@/config/media-upload';

/** Minimal but genuine file headers, so `file-type` really identifies them. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0'),
  Buffer.alloc(32),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function fileOf(buffer: Buffer, originalname: string, mimetype: string): Express.Multer.File {
  return {
    buffer,
    originalname,
    mimetype,
    size: buffer.length,
    fieldname: 'file',
    encoding: '7bit',
    stream: undefined as never,
    destination: '',
    filename: originalname,
    path: '',
  };
}

describe('upload allow list', () => {
  it('does not allow SVG', () => {
    // SVG is a script host, and uploaded media is served back from a data: URI
    // on the app's own origin (§3.3.2).
    expect(ALLOWED_UPLOAD_TYPES).not.toContain('image/svg+xml');
    expect(REJECTED_IMAGE_TYPES).toContain('image/svg+xml');
  });

  it('allows the ordinary raster formats and PDF', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']) {
      expect(ALLOWED_UPLOAD_TYPES).toContain(type);
    }
  });

  it('caps a single file at 10MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('isHeic', () => {
  it('detects by MIME type', () => {
    expect(isHeic({ mimetype: 'image/heic', originalname: 'photo.bin' })).toBe(true);
  });

  /** Browsers often send HEIC as application/octet-stream. */
  it('falls back to the file extension', () => {
    expect(isHeic({ mimetype: 'application/octet-stream', originalname: 'IMG_1234.HEIC' })).toBe(
      true,
    );
  });

  it('does not misidentify a PNG', () => {
    expect(isHeic({ mimetype: 'image/png', originalname: 'photo.png' })).toBe(false);
  });
});

describe('normalizeUpload — content-based verification (§3.8.2)', () => {
  it('accepts a real PNG and reports its detected type', async () => {
    const result = await normalizeUpload(fileOf(PNG, 'photo.png', 'image/png'));
    expect(result.mimeType).toBe('image/png');
    expect(result.isPdf).toBe(false);
  });

  it('accepts a real JPEG', async () => {
    const result = await normalizeUpload(fileOf(JPEG, 'photo.jpg', 'image/jpeg'));
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('accepts a real PDF and flags it for the viewer', async () => {
    const result = await normalizeUpload(fileOf(PDF, 'notes.pdf', 'application/pdf'));
    expect(result.mimeType).toBe('application/pdf');
    expect(result.isPdf).toBe(true);
  });

  /**
   * The attack this exists to stop: rename an SVG to .png, declare image/png,
   * and the old code stored and served it. SVG is text and has no magic bytes,
   * so it cannot be identified — and unidentifiable is refused.
   */
  it('rejects an SVG disguised as a PNG', async () => {
    await expect(normalizeUpload(fileOf(SVG, 'photo.png', 'image/png'))).rejects.toThrow(
      /could not be recognised/,
    );
  });

  it('rejects an HTML file disguised as an image', async () => {
    const html = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
    await expect(normalizeUpload(fileOf(html, 'photo.png', 'image/png'))).rejects.toThrow(
      /could not be recognised/,
    );
  });

  it('rejects an archive renamed to look like an image', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]);
    await expect(normalizeUpload(fileOf(zip, 'archive.png', 'image/png'))).rejects.toThrow(
      /could not be recognised/,
    );
  });

  it('rejects a video renamed to look like a photo', async () => {
    // An MP4 shares the ISO container with HEIC — only the brand differs.
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypisom'),
      Buffer.alloc(32),
    ]);
    await expect(normalizeUpload(fileOf(mp4, 'clip.heic', 'image/heic'))).rejects.toThrow(
      /could not be recognised/,
    );
  });

  it('trusts the detected type over the declared one', async () => {
    // Declared as a PDF, actually a PNG. What is stored must match the bytes.
    const result = await normalizeUpload(fileOf(PNG, 'thing.pdf', 'application/pdf'));
    expect(result.mimeType).toBe('image/png');
    expect(result.isPdf).toBe(false);
  });
});

describe('detectType — magic byte signatures', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['PDF', PDF, 'application/pdf'],
  ])('identifies a real %s', (_label, buffer, expected) => {
    expect(detectType(buffer)).toBe(expected);
  });

  it('identifies GIF, both revisions', () => {
    for (const header of ['GIF87a', 'GIF89a']) {
      const gif = Buffer.concat([Buffer.from(header), Buffer.alloc(32)]);
      expect(detectType(gif)).toBe('image/gif');
    }
  });

  it('identifies WebP by its RIFF form type, not just the container', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
      Buffer.alloc(16),
    ]);
    expect(detectType(webp)).toBe('image/webp');

    // A RIFF container that is not WebP — a WAV, say — must not be accepted.
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
      Buffer.alloc(16),
    ]);
    expect(detectType(wav)).toBeNull();
  });

  it('identifies BMP', () => {
    expect(detectType(Buffer.concat([Buffer.from('BM'), Buffer.alloc(32)]))).toBe('image/bmp');
  });

  it('identifies HEIC by brand', () => {
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(32),
    ]);
    expect(detectType(heic)).toBe('image/heic');
  });

  /**
   * MP4 and MOV share the ISO base media container with HEIC. Checking only
   * for "ftyp" would let a video through as a photo.
   */
  it('does not mistake an MP4 for a HEIC', () => {
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypisom'),
      Buffer.alloc(32),
    ]);
    expect(detectType(mp4)).toBeNull();
  });

  it.each([
    ['SVG', SVG],
    ['plain text', Buffer.from('just some text, long enough to pass the length check')],
    ['HTML', Buffer.from('<!doctype html><html><body>hi</body></html>')],
  ])('does not recognise %s', (_label, buffer) => {
    expect(detectType(buffer)).toBeNull();
  });

  it('refuses a buffer too short to carry a signature', () => {
    expect(detectType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
