/**
 * Oklahoma Homestead Rendezvous — Form → GitHub Auto-Deploy
 *
 * SETUP:
 * 1. Open your Google Form → ⋮ → Script editor
 * 2. Paste this entire file
 * 3. Set your secrets: Extensions → Apps Script → Project Settings → Script Properties
 *    GITHUB_TOKEN        = your GitHub personal access token (needs repo scope)
 *    GITHUB_OWNER        = HomesteadMediaGroup
 *    GITHUB_REPO         = oklahoma-homestead-rendezvous
 *    GITHUB_FILE         = site-data.json
 *    NETLIFY_BUILD_HOOK  = https://api.netlify.com/build_hooks/6a7a786ba453163d941311d8
 * 4. Run setupTrigger() once to install the form-submit trigger
 */

// ── COLUMN MAP ──────────────────────────────────────────────────────────────
// Update these numbers to match your Google Sheet column order (1-indexed).
// Open the Sheet, count from left: A=1, B=2, C=3 ...
const COL = {
  timestamp:        1,
  submitterName:    2,
  submitterRole:    3,
  submitterEmail:   4,
  submitterPhone:   5,

  // Speaker 1
  sp1Name:          6,
  sp1Farm:          7,
  sp1Topic:         8,
  sp1Bio:           9,
  sp1Photo:         10,
  sp1Link:          11,

  // Speaker 2
  sp2Name:          12,
  sp2Farm:          13,
  sp2Topic:         14,
  sp2Bio:           15,
  sp2Photo:         16,
  sp2Link:          17,

  // Speaker 3
  sp3Name:          18,
  sp3Farm:          19,
  sp3Topic:         20,
  sp3Bio:           21,
  sp3Photo:         22,
  sp3Link:          23,

  // Speaker 4
  sp4Name:          24,
  sp4Farm:          25,
  sp4Topic:         26,
  sp4Bio:           27,
  sp4Photo:         28,
  sp4Link:          29,

  // Sponsor 1
  sp1SponsorName:   30,
  sp1SponsorTag:    31,
  sp1SponsorLogo:   32,
  sp1SponsorSite:   33,

  // Sponsor 2
  sp2SponsorName:   34,
  sp2SponsorTag:    35,
  sp2SponsorLogo:   36,
  sp2SponsorSite:   37,

  // Ticket URL
  ticketUrl:        38,
};

// ── HELPERS ─────────────────────────────────────────────────────────────────

function driveThumb(rawUrl, size) {
  if (!rawUrl) return '';
  size = size || 'w400';
  // Extract file ID from various Drive URL formats
  var match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
              rawUrl.match(/id=([a-zA-Z0-9_-]+)/);
  if (!match) return rawUrl;
  return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=' + size;
}

function cell(row, col) {
  var v = row[col - 1];
  return v ? String(v).trim() : '';
}

function buildSpeaker(row, namCol, farmCol, topicCol, bioCol, photoCol, linkCol) {
  var name = cell(row, namCol);
  if (!name) return null;
  return {
    name:  name,
    title: cell(row, farmCol),
    topic: cell(row, topicCol),
    bio:   cell(row, bioCol),
    photo: driveThumb(cell(row, photoCol), 'w400'),
    link:  cell(row, linkCol)
  };
}

function buildSponsor(row, nameCol, tagCol, logoCol, siteCol) {
  var name = cell(row, nameCol);
  if (!name) return null;
  return {
    name:    name,
    tag:     cell(row, tagCol),
    level:   'sponsor',
    logo:    driveThumb(cell(row, logoCol), 'w300'),
    website: cell(row, siteCol)
  };
}

// ── MAIN TRIGGER ────────────────────────────────────────────────────────────

function onFormSubmit(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var lastRow = sheet.getLastRow();
    var row = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Build speakers array (skip empty entries)
    var speakers = [
      buildSpeaker(row, COL.sp1Name, COL.sp1Farm, COL.sp1Topic, COL.sp1Bio, COL.sp1Photo, COL.sp1Link),
      buildSpeaker(row, COL.sp2Name, COL.sp2Farm, COL.sp2Topic, COL.sp2Bio, COL.sp2Photo, COL.sp2Link),
      buildSpeaker(row, COL.sp3Name, COL.sp3Farm, COL.sp3Topic, COL.sp3Bio, COL.sp3Photo, COL.sp3Link),
      buildSpeaker(row, COL.sp4Name, COL.sp4Farm, COL.sp4Topic, COL.sp4Bio, COL.sp4Photo, COL.sp4Link),
    ].filter(Boolean);

    // Build sponsors array (skip empty entries)
    var sponsors = [
      buildSponsor(row, COL.sp1SponsorName, COL.sp1SponsorTag, COL.sp1SponsorLogo, COL.sp1SponsorSite),
      buildSponsor(row, COL.sp2SponsorName, COL.sp2SponsorTag, COL.sp2SponsorLogo, COL.sp2SponsorSite),
    ].filter(Boolean);

    // Fetch current site-data.json from GitHub to preserve existing data
    var props   = PropertiesService.getScriptProperties().getProperties();
    var owner   = props.GITHUB_OWNER;
    var repo    = props.GITHUB_REPO;
    var file    = props.GITHUB_FILE || 'site-data.json';
    var token   = props.GITHUB_TOKEN;
    var apiBase = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + file;

    var getResp = UrlFetchApp.fetch(apiBase, {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
      muteHttpExceptions: true
    });
    var current = JSON.parse(getResp.getContentText());
    var existingData = JSON.parse(Utilities.newBlob(Utilities.base64Decode(current.content)).getDataAsString());
    var sha = current.sha;

    // Merge: new submission overlays existing data; keep fields not in form
    if (speakers.length > 0) existingData.speakers = speakers;
    if (sponsors.length > 0) {
      // Merge with existing sponsors by name (add new, update existing)
      sponsors.forEach(function(newS) {
        var idx = existingData.sponsors.findIndex(function(s) { return s.name === newS.name; });
        if (idx >= 0) existingData.sponsors[idx] = newS;
        else existingData.sponsors.push(newS);
      });
    }
    var ticketUrl = cell(row, COL.ticketUrl);
    if (ticketUrl) existingData.ticket_url = ticketUrl;

    // Push updated JSON back to GitHub
    var newContent = Utilities.base64Encode(JSON.stringify(existingData, null, 2));
    var putResp = UrlFetchApp.fetch(apiBase, {
      method: 'PUT',
      headers: {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        message: 'Auto-update site-data.json from form submission (' + new Date().toISOString() + ')',
        content: newContent,
        sha: sha
      }),
      muteHttpExceptions: true
    });

    var result = JSON.parse(putResp.getContentText());
    Logger.log('GitHub push result: ' + putResp.getResponseCode());
    if (putResp.getResponseCode() !== 200) {
      Logger.log('Error: ' + JSON.stringify(result));
    } else {
      // Trigger Netlify redeploy
      var buildHook = props.NETLIFY_BUILD_HOOK;
      if (buildHook) {
        UrlFetchApp.fetch(buildHook, { method: 'POST', muteHttpExceptions: true });
        Logger.log('Netlify build triggered.');
      }
    }

  } catch(err) {
    Logger.log('onFormSubmit error: ' + err.toString());
  }
}

// ── TRIGGER INSTALLER ───────────────────────────────────────────────────────
// Run this function ONCE manually from the Apps Script editor to install
// the form-submit trigger. You do NOT need to run it again.

function setupTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Remove any existing triggers first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  Logger.log('Trigger installed successfully.');
}
