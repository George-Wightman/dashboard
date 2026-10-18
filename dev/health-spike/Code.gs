// THROWAWAY: the Google Health test. Not part of the dashboard, and nothing here is kept.
// It answers two questions:
//   1. probe   — can a script of your own read your Pixel Watch data, and what does it look like?
//   2. install — does it keep working for a week and more without you logging in again?
//      (an hourly heartbeat; run `report` any time to see how it's going)
// It only reads. Nothing is written to Google Health, and nothing leaves this script.
//
// The Health API refuses Apps Script's own login (it carries the script's permissions too), so
// this script has its own: an OAuth client in the Cloud project, asking for the health scopes only.
// Once: put CLIENT_ID and CLIENT_SECRET in Project Settings → Script properties, run authorize,
// open the link it logs and allow. The refresh token it gets is kept in the script's properties.

var BASE = 'https://health.googleapis.com/v4/users/me';
var SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly'
];

// If Project Settings won't take the script properties: paste the two values between the quotes,
// choose saveClient and press Run, then empty the quotes again and save.
function saveClient() {
  var clientId = '';
  var clientSecret = '';
  if (!clientId || !clientSecret) throw new Error('Paste the Client ID and Client secret between the quotes first.');
  PropertiesService.getScriptProperties().setProperties({ CLIENT_ID: clientId.trim(), CLIENT_SECRET: clientSecret.trim() });
  Logger.log('Saved. Empty the two quotes again, save, and run authorize.');
}

function redirect_() {
  return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
}

function authorize() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLIENT_ID') || !props.getProperty('CLIENT_SECRET')) {
    throw new Error('Add CLIENT_ID and CLIENT_SECRET in Project Settings → Script properties first.');
  }
  var state = ScriptApp.newStateToken().withMethod('authCallback').withTimeout(3600).createToken();
  var url = 'https://accounts.google.com/o/oauth2/v2/auth?' + [
    'client_id=' + encodeURIComponent(props.getProperty('CLIENT_ID')),
    'redirect_uri=' + encodeURIComponent(redirect_()),
    'response_type=code',
    'scope=' + encodeURIComponent(SCOPES.join(' ')),
    'access_type=offline',
    'prompt=consent',
    'state=' + encodeURIComponent(state)
  ].join('&');
  Logger.log('Open this link, choose your account and allow everything:\n' + url);
}

function authCallback(request) {
  var props = PropertiesService.getScriptProperties();
  if (request.parameter.error) return HtmlService.createHtmlOutput('Not allowed: ' + request.parameter.error);
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      code: request.parameter.code,
      client_id: props.getProperty('CLIENT_ID'),
      client_secret: props.getProperty('CLIENT_SECRET'),
      redirect_uri: redirect_(),
      grant_type: 'authorization_code'
    }
  });
  var json = JSON.parse(res.getContentText() || '{}');
  if (!json.refresh_token) return HtmlService.createHtmlOutput('No refresh token came back: ' + res.getContentText().slice(0, 300));
  props.setProperty('REFRESH_TOKEN', json.refresh_token);
  props.setProperty('AUTHORIZED', new Date().toISOString());
  CacheService.getScriptCache().put('ACCESS_TOKEN', json.access_token, 3000);
  return HtmlService.createHtmlOutput('Done — close this tab and run probe.');
}

function token_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('ACCESS_TOKEN');
  if (cached) return cached;
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('REFRESH_TOKEN')) throw new Error('Not authorized yet: run authorize first.');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      refresh_token: props.getProperty('REFRESH_TOKEN'),
      client_id: props.getProperty('CLIENT_ID'),
      client_secret: props.getProperty('CLIENT_SECRET'),
      grant_type: 'refresh_token'
    }
  });
  var json = JSON.parse(res.getContentText() || '{}');
  if (!json.access_token) throw new Error('Refresh failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  cache.put('ACCESS_TOKEN', json.access_token, 3000);
  return json.access_token;
}

function fetch_(method, path, body) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token_(), Accept: 'application/json' },
    muteHttpExceptions: true
  };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(BASE + path, options);
  return { code: res.getResponseCode(), text: res.getContentText() };
}

function day_(daysAgo) {
  return Utilities.formatDate(new Date(Date.now() - daysAgo * 86400000), 'Europe/London', 'yyyy-MM-dd');
}

function list_(type, filter) {
  var path = '/dataTypes/' + type + '/dataPoints?pageSize=25';
  var res = fetch_('get', path + (filter ? '&filter=' + encodeURIComponent(filter) : ''));
  if (res.code === 400 && filter) {
    var retry = fetch_('get', path);
    retry.note = 'filter refused (' + res.text.slice(0, 160).replace(/\s+/g, ' ') + '), retried without it';
    return retry;
  }
  return res;
}

function show_(label, res, sampleChars) {
  var line = label + ': HTTP ' + res.code;
  if (res.note) line += ' — ' + res.note;
  if (res.code !== 200) {
    Logger.log(line + '\n  ' + res.text.slice(0, 400).replace(/\s+/g, ' '));
    return;
  }
  var json = JSON.parse(res.text || '{}');
  var points = json.dataPoints || json.rollupDataPoints || [];
  Logger.log(line + ' · ' + points.length + ' points\n  first: ' +
    JSON.stringify(points[0] || json).slice(0, sampleChars || 500));
}

function probe() {
  var week = day_(7), fortnight = day_(14);
  show_('identity', fetch_('get', '/identity'));
  show_('resting heart rate', list_('daily-resting-heart-rate', 'daily_resting_heart_rate.date >= "' + week + '"'));
  show_('HRV (daily)', list_('daily-heart-rate-variability', 'daily_heart_rate_variability.date >= "' + week + '"'));
  show_('SpO2 (daily)', list_('daily-oxygen-saturation', 'daily_oxygen_saturation.date >= "' + week + '"'));
  show_('VO2 max (daily)', list_('daily-vo2-max', 'daily_vo2_max.date >= "' + fortnight + '"'));
  show_('sleep', list_('sleep', 'sleep.interval.civil_end_time >= "' + week + '"'), 900);
  show_('weight', list_('weight', 'weight.sample_time.civil_time >= "' + fortnight + 'T00:00:00"'));
  show_('active zone minutes', list_('active-zone-minutes', 'active_zone_minutes.interval.civil_start_time >= "' + week + 'T00:00:00"'));

  // The one that matters most: the cardio the watch logs on its own.
  var ex = list_('exercise', 'exercise.interval.civil_start_time >= "' + fortnight + 'T00:00:00"');
  show_('exercise (last 14 days)', ex, 1500);
  if (ex.code === 200) {
    (JSON.parse(ex.text).dataPoints || []).forEach(function (p) {
      var e = p.exercise || {}, i = e.interval || {};
      var mins = i.startTime && i.endTime ? Math.round((new Date(i.endTime) - new Date(i.startTime)) / 60000) : '?';
      Logger.log('  · ' + (i.startTime || '?') + ' ' + (e.exerciseType || '?') + ' ' + mins + ' min' +
        (p.dataSource && p.dataSource.device ? ' (' + p.dataSource.device.displayName + ')' : ''));
    });
  }

  // Daily step totals for the week, to check the daily roll-up works.
  var s = new Date(Date.now() - 7 * 86400000), e = new Date();
  show_('steps, daily totals', fetch_('post', '/dataTypes/steps/dataPoints:dailyRollUp', {
    range: {
      start: { date: { year: s.getFullYear(), month: s.getMonth() + 1, day: s.getDate() }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } },
      end: { date: { year: e.getFullYear(), month: e.getMonth() + 1, day: e.getDate() }, time: { hours: 23, minutes: 59, seconds: 59, nanos: 0 } }
    },
    windowSizeDays: 1
  }), 800);
}

// The week-long check. Every hour: one tiny read, its result kept in this script's properties.
// If Google's login lapses, the hourly runs stop or start failing, and `report` shows when.
function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('heartbeat').timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().setProperty('STARTED', new Date().toISOString());
  heartbeat();
  Logger.log('Installed: one small read every hour. Run report any time.');
}

function heartbeat() {
  var code;
  try { code = list_('daily-resting-heart-rate', 'daily_resting_heart_rate.date >= "' + day_(3) + '"').code; }
  catch (err) { code = 'err:' + String(err.message || err).slice(0, 40); }
  var props = PropertiesService.getScriptProperties();
  var beats = (props.getProperty('BEATS') || '').split(',').filter(String);
  beats.push(Utilities.formatDate(new Date(), 'Europe/London', 'dd/MM HH:mm') + '=' + code);
  props.setProperty('BEATS', beats.slice(-400).join(','));
}

function report() {
  var props = PropertiesService.getScriptProperties();
  var beats = (props.getProperty('BEATS') || '').split(',').filter(String);
  if (!beats.length) { Logger.log('No heartbeats yet — run install first.'); return; }
  var ok = beats.filter(function (b) { return /=200$/.test(b); }).length;
  var firstBad = beats.filter(function (b) { return !/=200$/.test(b); })[0];
  Logger.log('Started ' + props.getProperty('STARTED') + ' · ' + beats.length + ' heartbeats, ' + ok + ' fine' +
    (firstBad ? ' · first problem: ' + firstBad : ' · no problems') +
    '\nFirst: ' + beats[0] + ' · last: ' + beats[beats.length - 1] +
    '\n(It is ' + Utilities.formatDate(new Date(), 'Europe/London', 'dd/MM HH:mm') +
    ' now: a last heartbeat more than an hour or two old means the hourly runs have stopped.)');
}
