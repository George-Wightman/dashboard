// Builds planner/planner.js: planner/entry.js and every module it imports (from planner/ and js/),
// each wrapped in a function of its own so their top-level names can't collide, in one plain
// script that defines PLANNER_BUILD and Planner — Apps Script has no modules. Only the shapes the
// planner's modules use are allowed, and anything else fails the build rather than the calendar.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT = /^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

const varName = (path) => `__${path.replace(/\.m?js$/, '').replace(/\W/g, '_')}`;

export function bundle({ entry = 'planner/entry.js', read }) {
  const order = [];
  const seen = new Set();

  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const src = read(path).replace(/\r\n/g, '\n');
    if (/^export\s+(default|\{|\*)/m.test(src)) throw new Error(`${path}: only "export function|const|let|class" can be bundled`);
    if (/^import\s+[\w$*]/m.test(src) || /\bimport\s*\(/.test(src)) throw new Error(`${path}: only named imports can be bundled`);
    const deps = [];
    const body = src.replace(IMPORT, (_, names, from) => {
      if (!from.startsWith('.')) throw new Error(`${path}: can't bundle "${from}"`);
      const dep = posix.normalize(posix.join(posix.dirname(path), from));
      deps.push(dep);
      const list = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': '));
      return `const { ${list.join(', ')} } = ${varName(dep)};`;
    });
    for (const dep of deps) visit(dep);
    const names = [...body.matchAll(EXPORT)].map((m) => m[2]);
    order.push({ path, names, code: body.replace(EXPORT, (_, kind, name) => `${kind} ${name}`).trimEnd() });
  }

  visit(entry);
  const modules = order.map(({ path, names, code }) =>
    `// ---- ${path}\nconst ${varName(path)} = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`);
  const body = `${modules.join('\n\n')}\n\nvar Planner = ${varName(entry)}.Planner;\n`;
  const build = createHash('sha1').update(body).digest('hex').slice(0, 8);
  const code = [
    "// Dashboard calendar planner — built by `npm run build-planner` from planner/ and js/. Don't edit by hand.",
    `var PLANNER_BUILD = '${build}';`,
    '',
    body,
  ].join('\n');
  return { code, build };
}
