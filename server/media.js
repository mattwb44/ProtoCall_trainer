import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Disk-backed store shaped like object storage so an S3 swap touches only this file.
export function createMediaStore(dir = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media')) {
  fs.mkdirSync(dir, { recursive: true });

  return {
    dir,
    // Returns the public URL, or null if the mimetype isn't an accepted image.
    async save(buffer, mimetype) {
      const ext = EXT_BY_MIME[mimetype];
      if (!ext) return null;
      const name = `${randomUUID()}.${ext}`;
      await fs.promises.writeFile(path.join(dir, name), buffer);
      return `/media/${name}`;
    },
  };
}
