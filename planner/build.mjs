// npm run build-planner: writes planner/planner.js, which GitHub Pages serves to George's Apps
// Script loader. Commit the result — tests/planner-bundle.test.js fails when it's out of date.

import { readFileSync, writeFileSync } from 'node:fs';
import { bundle } from './bundle.mjs';

const root = new URL('../', import.meta.url);
const { code, build } = bundle({ read: (path) => readFileSync(new URL(path, root), 'utf8') });
writeFileSync(new URL('planner/planner.js', root), code);
console.log(`planner/planner.js built — ${build}, ${Math.round(code.length / 1024)} KB`);
