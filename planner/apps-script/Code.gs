// Dashboard planner — plans your dashboard into your Google Calendar. This file only loads the
// planner from your dashboard's site, so updates arrive by themselves (within ten minutes).
// Once: set the script properties (GITHUB_TOKEN, SYNC_REPO, and GEMINI_KEY if you like), then
// choose install in the toolbar and press Run.

var PLANNER_URL = 'https://george-wightman.github.io/dashboard/planner/planner.js';

// Whether this execution had to fetch the planner (1) or found it kept (0): the planner counts its
// web calls, and Google allows 20,000 a day.
var PLANNER_LOAD_FETCHES = 0;

// The planner is kept in the script's cache for ten minutes, in parts (one entry holds 100 KB), so
// every run, calendar edit and widget doesn't fetch 600 KB again (24 Nov 2026: the daily allowance
// of web calls ran out).
var CODE_PART = 30000;
var CODE_SECONDS = 600;

function cachedCode_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get('planner:n'));
    if (!(n > 0 && n <= 60)) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push('planner:' + i);
    var got = cache.getAll(keys);
    var parts = [];
    for (var j = 0; j < n; j++) {
      if (typeof got[keys[j]] !== 'string') return null;
      parts.push(got[keys[j]]);
    }
    return parts.join('');
  } catch (e) { return null; }
}

function keepCode_(text) {
  try {
    var cache = CacheService.getScriptCache();
    var parts = {};
    var n = Math.ceil(text.length / CODE_PART);
    if (n > 60) return;
    for (var i = 0; i < n; i++) parts['planner:' + i] = text.slice(i * CODE_PART, (i + 1) * CODE_PART);
    cache.putAll(parts, CODE_SECONDS);
    cache.put('planner:n', String(n), CODE_SECONDS);
  } catch (e) { /* only a saving */ }
}

function load_() {
  var text = cachedCode_();
  if (text == null) {
    var res = UrlFetchApp.fetch(PLANNER_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    PLANNER_LOAD_FETCHES = 1;
    if (res.getResponseCode() !== 200) {
      throw new Error("Couldn't load the planner from " + PLANNER_URL + ' (' + res.getResponseCode() + ')');
    }
    text = res.getContentText();
    keepCode_(text);
  }
  return new Function(text + '\nreturn Planner;')();
}

function say_(promise) {
  return promise.then(function (text) { Logger.log(text); return text; });
}

function run(e) { return load_().run(e); }
function install() { return say_(load_().install()); }
function pause() { return say_(load_().pause()); }
function resume() { return say_(load_().resume()); }
function removeAll() { return say_(load_().removeAll()); }

// Claude's way in when its own sandbox can't reach GitHub: Deploy > New deployment > Web app,
// execute as you, anyone can access. The key it checks lives in the sync repo (relay.json).
// The phone's widgets ask here too. After changing this file, Deploy > Manage deployments > edit >
// Version: New version, or the web app keeps the old one (the address stays the same).
function doPost(e) { return load_().relay(e); }

// The ✓ link in each calendar block: one tap ticks it. Same web app.
function doGet(e) { return load_().tick(e); }
