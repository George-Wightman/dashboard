// Builds the dashboard skill for upload to claude.ai: SKILL.md, reference.md and run.sh from
// claude/skill/, plus the key's config.json, zipped under a dashboard/ folder. The config and the
// zip both live outside the repo (which sits in Google Drive): in ~/.dashboard-skill, or wherever
// DASH_SKILL_DIR points. Run with: npm run build-skill

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from './config.js';
import { zipFiles } from './zip.js';

export const PLACEHOLDER = 'PASTE-THE-CLAUDE-SKILL-KEY-HERE';
export const SKILL_FILES = ['SKILL.md', 'reference.md', 'run.sh'];

const SKILL_DIR = fileURLToPath(new URL('./skill/', import.meta.url));

export function buildSkill({ configText, read = (name) => readFileSync(join(SKILL_DIR, name)) }) {
  if (configText.includes(PLACEHOLDER)) {
    throw new Error(`Paste the Claude skill key into config.json first, in place of ${PLACEHOLDER}.`);
  }
  readConfig(configText);
  return zipFiles([
    ...SKILL_FILES.map((name) => ({ name: `dashboard/${name}`, data: read(name), mode: name.endsWith('.sh') ? 0o755 : 0o644 })),
    { name: 'dashboard/config.json', data: Buffer.from(configText), mode: 0o600 },
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.DASH_SKILL_DIR || join(homedir(), '.dashboard-skill');
  const configPath = join(dir, 'config.json');
  try {
    const zip = buildSkill({ configText: readFileSync(configPath, 'utf8') });
    const target = join(dir, 'dashboard-skill.zip');
    writeFileSync(target, zip);
    console.log(`Built ${target} (${zip.length} bytes). Upload it at claude.ai → Settings → Capabilities → Skills.`);
  } catch (e) {
    console.error(e.code === 'ENOENT'
      ? `No config at ${configPath}. Copy claude/skill/config.example.json there and paste the key in.`
      : e.message);
    process.exitCode = 1;
  }
}
