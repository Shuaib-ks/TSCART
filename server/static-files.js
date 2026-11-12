import path from 'node:path';
import { insist } from './security.js';

// URL paths use forward slashes; filesystem paths follow the host OS.
// Injecting a path implementation lets the tests exercise Windows on Linux.
export function resolvePublicFile(base, pathname, paths = path) {
  insist(typeof pathname === 'string' && pathname.startsWith('/') &&
    !/[\\\0:]/.test(pathname), 'Not found.', 404);
  const file = paths.resolve(base, '.' + pathname);
  const relative = paths.relative(base, file);
  insist(relative !== '..' && !relative.startsWith('..' + paths.sep) &&
    !paths.isAbsolute(relative), 'Not found.', 404);
  return paths.extname(file) ? file : paths.join(base, 'index.html');
}
