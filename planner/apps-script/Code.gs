// Dashboard planner — plans your dashboard into your Google Calendar. This file only loads the
// planner from your dashboard's site each time it runs, so updates arrive by themselves.
// Once: set the script properties (GITHUB_TOKEN, SYNC_REPO, and GEMINI_KEY if you like), then
// choose install in the toolbar and press Run.

var PLANNER_URL = 'https://george-wightman.github.io/dashboard/planner/planner.js';

function load_() {
  var res = UrlFetchApp.fetch(PLANNER_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("Couldn't load the planner from " + PLANNER_URL + ' (' + res.getResponseCode() + ')');
  }
  return new Function(res.getContentText() + '\nreturn Planner;')();
}

function say_(promise) {
  return promise.then(function (text) { Logger.log(text); return text; });
}

function run(e) { return load_().run(e); }
function install() { return say_(load_().install()); }
function pause() { return say_(load_().pause()); }
function resume() { return say_(load_().resume()); }
function removeAll() { return say_(load_().removeAll()); }
