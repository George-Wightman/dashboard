// The bundle's entry (npm run build-planner): Apps Script's services in, `Planner` out. Only ever
// run inside Apps Script, or the bundle test's sandbox, where these globals exist.

import { installShims } from './shims.js';
import { createPlanner } from './gas.js';

export const Planner = (() => {
  installShims(globalThis, { Utilities, UrlFetchApp });
  return createPlanner({
    Calendar, UrlFetchApp, PropertiesService, LockService, ScriptApp, Logger, Utilities,
    // Drive only once George has approved the planner's new permission; until then the Mind reads none.
    DriveApp: typeof DriveApp === 'undefined' ? null : DriveApp,
    fetch: (...args) => globalThis.fetch(...args),
    version: typeof PLANNER_BUILD === 'string' ? PLANNER_BUILD : 'dev',
  });
})();
