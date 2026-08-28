/**
 * Oklahoma Homestead Rendezvous — Form → GitHub Auto-Deploy
 *
 * SETUP:
 * 1. Open your Google Form → Extensions → Apps Script
 * 2. Paste this entire file, save, run setupTrigger() once
 *
 * Script Properties required (Project Settings → Script Properties):
 *    GITHUB_TOKEN        = GitHub personal access token (repo scope)
 *    GITHUB_OWNER        = HomesteadMediaGroup
 *    GITHUB_REPO         = oklahoma-homestead-rendezvous
 *    GITHUB_FILE         = site-data.json
 *
 * NOTE: No build hook needed. site-data.json is fetched live from GitHub by the site.
 *       Form submit → GitHub push → site updates on next page load automatically.
 *       Drive photos are downloaded and pushed to GitHub assets — no Drive URLs on live site.
 */

// ── EXACT COLUMN MAP (1-indexed, based on actual sheet headers) ─────────────
const COL = {
  timestamp:        1,
  email:            2,
  fullName:         3,
  role:             4,
  email2:           5,
  phone:            6,
  logoLink:         7,
  logoNote:         8,
  tagline:          9,
  ticketUrl:        10,
  customDomain:     11,
  eventPhotos:      12,
  venuePhotos:      13,
  photoNotes:       14,

  sp1Name:          15,
  sp1Title:         16,
  sp1Topic:         17,
  sp1Bio:           18,
  sp1Link:          19,
  sp1Photo:         20,

  sp2Name:          21,
  sp2Title:         22,
  sp2Topic:         23,
  sp2Bio:           24,
  sp2Link:          25,
  sp2Photo:         26,

  sp3Name:          27,
  sp3Title:         28,
  sp3Topic:         29,
  sp3Bio:           30,
  sp3Link:          31,
  sp3Photo:         32,

  sp4Name:          33,
  sp4Title:         34,
  sp4Topic:         35,
  sp4Bio:           36,
  sp4Link:          37,
  sp4Photo:         38,

  spon1Name:        39,
  spon1Tag:         40,
  spon1Level:       41,
  spon1Site:        42,
  spon1Logo:        43,

  spon2Name:        44,
  spon2Tag:         45,
  spon2Level:       46,
  spon2Site:        47,
  spon2Logo:        48,

  spon3Name:        49,
  spon3Tag:         50,
  spon3Level:       51,
  spon3Site:        52,
  spon3Logo:        53,

  spon4Name:        54,
  spon4Tag:         55,
  spon4Level:       56,
  spon4Site:        57,
  spon4Logo:        58,

  spon5Name:        59,
  spon5Tag:         60,
  spon5Level:       61,
  spon5Site:        62,
  spon5Logo:        63,

  spon6Name:        64,
  spon6Tag:         65,
  spon6Level:       66,
  spon6Site:        67,
  spon6Logo:        68,

  facebook:         69,
  instagram:        70,
  tiktok:           71,
  youtube:          72,
  corrections:      73,
  promoCopy:        74,
  otherFiles:       75,
  notes:            76,
  removeSpeakers:   77,
  removeSponsors:   78
};

// ── HELPERS ─────────────────────────────────────────────────────────────────

function cell(row, col) {
  var v = row[col - 1];
  return v ? String(v).trim() : '';
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[&]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getDriveFileId(url) {
  if (!url) return null;
  var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
              url.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Download a Google Drive image and push it to GitHub assets/speakers/.
 * Returns the local path (/assets/speakers/filename.jpg) on success, '' on failure.
 */
function uploadDriveImageToGithub(driveUrl, name, folder, token, owner, repo) {
  var fileId = getDriveFileId(driveUrl);
  if (!fileId) { Logger.log('No Drive file ID found in: ' + driveUrl); return ''; }

  var driveFile;
  try { driveFile = DriveApp.getFileById(fileId); }
  catch(e) { Logger.log('Could not access Drive file ' + fileId + ': ' + e.toString()); return ''; }

  var blob = driveFile.getBlob();
  var mimeType = blob.getContentType();
  var ext = mimeType === 'image/png' ? 'png' : 'jpg';
  var filename = slugify(name) + '.' + ext;
  var githubPath = folder + '/' + filename;
  var localPath = '/' + githubPath;

  var base64Content = Utilities.base64Encode(blob.getBytes());
  var apiBase = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + githubPath;

  // Check if file already exists (to get SHA for update)
  var getResp = UrlFetchApp.fetch(apiBase, {
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
    muteHttpExceptions: true
  });

  var payload = { message: 'Auto-upload photo for ' + name, content: base64Content };
  if (getResp.getResponseCode() === 200) {
    payload.sha = JSON.parse(getResp.getContentText()).sha;
  }

  var putResp = UrlFetchApp.fetch(apiBase, {
    method: 'PUT',
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = putResp.getResponseCode();
  if (code === 200 || code === 201) {
    Logger.log('Photo uploaded to GitHub: ' + githubPath);
    return localPath;
  } else {
    Logger.log('Photo upload failed (' + code + '): ' + putResp.getContentText());
    return '';
  }
}

function buildSpeaker(row, nameCol, titleCol, topicCol, bioCol, linkCol, photoCol, token, owner, repo) {
  var name = cell(row, nameCol);
  if (!name) return null;

  var rawPhoto = cell(row, photoCol);
  var photo = '';
  if (rawPhoto) {
    // If it looks like a Drive URL, upload to GitHub and use local path
    if (getDriveFileId(rawPhoto)) {
      photo = uploadDriveImageToGithub(rawPhoto, name, 'assets/speakers', token, owner, repo);
    } else {
      photo = rawPhoto; // already a direct URL
    }
  }

  return {
    name:  name,
    title: cell(row, titleCol),
    topic: cell(row, topicCol),
    bio:   cell(row, bioCol),
    link:  cell(row, linkCol),
    photo: photo
  };
}

function buildSponsor(row, nameCol, tagCol, levelCol, siteCol, logoCol, token, owner, repo) {
  var name = cell(row, nameCol);
  if (!name) return null;

  var rawLogo = cell(row, logoCol);
  var logo = '';
  if (rawLogo) {
    if (getDriveFileId(rawLogo)) {
      logo = uploadDriveImageToGithub(rawLogo, name, 'assets/sponsors', token, owner, repo);
    } else {
      logo = rawLogo;
    }
  }

  return {
    name:    name,
    tag:     cell(row, tagCol),
    level:   cell(row, levelCol) || 'sponsor',
    website: cell(row, siteCol),
    logo:    logo
  };
}

// Merge by name: update existing entry or append new one
function mergeByName(existingArr, newItems) {
  newItems.forEach(function(newItem) {
    var idx = -1;
    for (var i = 0; i < existingArr.length; i++) {
      if (existingArr[i].name === newItem.name) { idx = i; break; }
    }
    // Only overwrite non-empty fields — preserve existing data if new field is blank
    if (idx >= 0) {
      Object.keys(newItem).forEach(function(k) {
        if (newItem[k]) existingArr[idx][k] = newItem[k];
      });
    } else {
      existingArr.push(newItem);
    }
  });
  return existingArr;
}

// ── MAIN TRIGGER ────────────────────────────────────────────────────────────

function onFormSubmit(e) {
  try {
    var form = FormApp.getActiveForm();
    var destId = form.getDestinationId();
    var sheet = SpreadsheetApp.openById(destId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    var row = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];

    Logger.log('Processing row ' + lastRow + ' — name: ' + cell(row, COL.fullName));

    // Load script properties
    var props   = PropertiesService.getScriptProperties().getProperties();
    var owner   = props.GITHUB_OWNER;
    var repo    = props.GITHUB_REPO;
    var file    = props.GITHUB_FILE || 'site-data.json';
    var token   = props.GITHUB_TOKEN;

    // Build new speakers from this submission (Drive photos auto-uploaded to GitHub)
    var newSpeakers = [
      buildSpeaker(row, COL.sp1Name, COL.sp1Title, COL.sp1Topic, COL.sp1Bio, COL.sp1Link, COL.sp1Photo, token, owner, repo),
      buildSpeaker(row, COL.sp2Name, COL.sp2Title, COL.sp2Topic, COL.sp2Bio, COL.sp2Link, COL.sp2Photo, token, owner, repo),
      buildSpeaker(row, COL.sp3Name, COL.sp3Title, COL.sp3Topic, COL.sp3Bio, COL.sp3Link, COL.sp3Photo, token, owner, repo),
      buildSpeaker(row, COL.sp4Name, COL.sp4Title, COL.sp4Topic, COL.sp4Bio, COL.sp4Link, COL.sp4Photo, token, owner, repo)
    ].filter(Boolean);

    // Build new sponsors from this submission
    var newSponsors = [
      buildSponsor(row, COL.spon1Name, COL.spon1Tag, COL.spon1Level, COL.spon1Site, COL.spon1Logo, token, owner, repo),
      buildSponsor(row, COL.spon2Name, COL.spon2Tag, COL.spon2Level, COL.spon2Site, COL.spon2Logo, token, owner, repo),
      buildSponsor(row, COL.spon3Name, COL.spon3Tag, COL.spon3Level, COL.spon3Site, COL.spon3Logo, token, owner, repo),
      buildSponsor(row, COL.spon4Name, COL.spon4Tag, COL.spon4Level, COL.spon4Site, COL.spon4Logo, token, owner, repo),
      buildSponsor(row, COL.spon5Name, COL.spon5Tag, COL.spon5Level, COL.spon5Site, COL.spon5Logo, token, owner, repo),
      buildSponsor(row, COL.spon6Name, COL.spon6Tag, COL.spon6Level, COL.spon6Site, COL.spon6Logo, token, owner, repo)
    ].filter(Boolean);

    Logger.log('New speakers found: ' + newSpeakers.length);
    Logger.log('New sponsors found: ' + newSponsors.length);
    Logger.log('Done. Photos uploaded to GitHub. Site updates on next page load.');

    // Fetch current site-data.json from GitHub
    var apiBase = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + file;

    var getResp = UrlFetchApp.fetch(apiBase, {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
      muteHttpExceptions: true
    });
    var current = JSON.parse(getResp.getContentText());
    var existingData = JSON.parse(Utilities.newBlob(Utilities.base64Decode(current.content)).getDataAsString());
    var sha = current.sha;

    // Merge speakers (add new, update existing by name, preserve unlisted)
    if (newSpeakers.length > 0) {
      existingData.speakers = mergeByName(existingData.speakers || [], newSpeakers);
    }

    // Merge sponsors (add new, update existing by name, preserve unlisted)
    if (newSponsors.length > 0) {
      existingData.sponsors = mergeByName(existingData.sponsors || [], newSponsors);
    }

    // Remove speakers by name if requested
    var removeSpeakersRaw = cell(row, COL.removeSpeakers);
    if (removeSpeakersRaw) {
      var removeNames = removeSpeakersRaw.split('\n').map(function(n) { return n.trim().toLowerCase(); }).filter(Boolean);
      existingData.speakers = (existingData.speakers || []).filter(function(s) {
        return removeNames.indexOf(s.name.toLowerCase()) === -1;
      });
      Logger.log('Removed speakers: ' + removeNames.join(', '));
    }

    // Remove sponsors by name if requested
    var removeSponsorsRaw = cell(row, COL.removeSponsors);
    if (removeSponsorsRaw) {
      var removeSponsorNames = removeSponsorsRaw.split('\n').map(function(n) { return n.trim().toLowerCase(); }).filter(Boolean);
      existingData.sponsors = (existingData.sponsors || []).filter(function(s) {
        return removeSponsorNames.indexOf(s.name.toLowerCase()) === -1;
      });
      Logger.log('Removed sponsors: ' + removeSponsorNames.join(', '));
    }

    // Update other fields only if provided
    var ticketUrl = cell(row, COL.ticketUrl);
    if (ticketUrl) existingData.ticket_url = ticketUrl;

    var logoLink = cell(row, COL.logoLink);
    if (logoLink) {
      if (getDriveFileId(logoLink)) {
        existingData.logo_path = uploadDriveImageToGithub(logoLink, 'event-logo', 'assets', token, owner, repo);
      } else {
        existingData.logo_path = logoLink;
      }
    }

    // Push updated JSON to GitHub
    var newContent = Utilities.base64Encode(JSON.stringify(existingData, null, 2));
    var putResp = UrlFetchApp.fetch(apiBase, {
      method: 'PUT',
      headers: {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        message: 'Auto-update from form submission — ' + cell(row, COL.fullName) + ' (' + new Date().toISOString() + ')',
        content: newContent,
        sha: sha
      }),
      muteHttpExceptions: true
    });

    var code = putResp.getResponseCode();
    Logger.log('GitHub push: ' + code);

    if (code === 200) {
      Logger.log('GitHub push successful. site-data.json updated. Site will reflect changes on next page load.');
    } else {
      Logger.log('GitHub error: ' + putResp.getContentText());
    }

  } catch(err) {
    Logger.log('onFormSubmit error: ' + err.toString());
  }
}

// ── TRIGGER INSTALLER ───────────────────────────────────────────────────────
// Run this function ONCE from the Apps Script editor to install the trigger.

function setupTrigger() {
  var form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();
  Logger.log('Trigger installed successfully.');
}
