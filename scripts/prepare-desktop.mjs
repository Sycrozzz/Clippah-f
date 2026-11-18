import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');
const output = path.join(root, 'desktop', 'packaged-app');

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  throw new Error('Next.js standalone output not found. Run `npm run build` first.');
}
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(standalone, output, { recursive: true });

const staticSource = path.join(root, '.next', 'static');
if (fs.existsSync(staticSource)) {
  fs.mkdirSync(path.join(output, '.next'), { recursive: true });
  fs.cpSync(staticSource, path.join(output, '.next', 'static'), { recursive: true });
}
const publicSource = path.join(root, 'public');
if (fs.existsSync(publicSource)) fs.cpSync(publicSource, path.join(output, 'public'), { recursive: true });
console.log(`Prepared standalone app at ${output}`);
