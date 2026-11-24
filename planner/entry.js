// The bundle's entry (npm run build-planner): Apps Script's services in, `Planner` out. Only ever
// run inside Apps Script, or the bundle test's sandbox, where these globals exist.

import { installShims } from './shims.js';
import { createPlanner } from './gas.js';

export const Planner = (() => {
  // Every web call this execution makes, counted (planner/cache.js addFetches): Google allows 20,000 a
  // day, and on 24 Nov 2026 the planner ran out of them with nothing to say where they went.
  let calls = 0;
  const counting = {
    fetch: (...args) => { calls += 1; return UrlFetchApp.fetch(...args); },
    fetchAll: (requests) => { calls += requests.length; return UrlFetchApp.fetchAll(requests); },
  };
  installShims(globalThis, { Utilities, UrlFetchApp: counting });
  return createPlanner({
    Calendar, UrlFetchApp: counting, PropertiesService, LockService, ScriptApp, Logger, Utilities, ContentService: typeof ContentService === 'undefined' ? null : ContentService,
    CacheService: typeof CacheService === 'undefined' ? null : CacheService,
    fetch: (...args) => globalThis.fetch(...args),
    version: typeof PLANNER_BUILD === 'string' ? PLANNER_BUILD : 'dev',
    fetchCount: () => calls,
    // The loader says whether it had to fetch this bundle (planner/apps-script/Code.gs); an older
    // loader always did.
    loadFetches: typeof PLANNER_LOAD_FETCHES === 'number' ? PLANNER_LOAD_FETCHES : 1,
  });
})();
