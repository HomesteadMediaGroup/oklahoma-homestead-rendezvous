#!/usr/bin/env node
/**
 * OKHR Asset Intake Applier
 * Usage: node scripts/apply-intake.js
 *
 * Fetches the latest okhr-asset-intake submission from Netlify Forms,
 * shows a preview, asks for confirmation, downloads files, updates
 * site-data.json, then deploys to production.
 *
 * Requires: NETLIFY_TOKEN in .env (or environment)
 *           NETLIFY_SITE_ID in .env (or environment)
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const readline = require('readline');

// ── Load .env ──
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const TOKEN   = process.env.NETLIFY_TOKEN;
const SITE_ID = process.env.NETLIFY_SITE_ID;
const ROOT    = path.join(__dirname, '..');

if (!TOKEN)   { console.error('\n❌  NETLIFY_TOKEN not set. Add it to .env\n'); process.exit(1); }
if (!SITE_ID) { console.error('\n❌  NETLIFY_SITE_ID not set. Add it to .env\n'); process.exit(1); }

// ── Helpers ──
function netlifyGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.netlify.com',
      path: `/api/v1${endpoint}`,
      headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'okhr-apply-intake' }
    };
    https.get(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Parse error: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    // Netlify file uploads may need the auth token
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { Authorization: `Bearer ${TOKEN}` }
    };
    const file = fs.createWriteStream(dest);
    https.get(options, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function ext(url) {
  const match = (url || '').match(/\.([a-z0-9]+)(\?|$)/i);
  return match ? '.' + match[1].toLowerCase() : '.jpg';
}

// ── Main ──
(async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OKHR Asset Intake Applier');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Find the form
  console.log('🔍  Fetching forms for site…');
  const forms = await netlifyGet(`/sites/${SITE_ID}/forms`);
  const form  = forms.find(f => f.name === 'okhr-asset-intake');
  if (!form) {
    console.error('❌  Form "okhr-asset-intake" not found. Has anyone submitted it yet?');
    process.exit(1);
  }
  console.log(`✓   Found form: ${form.name} (${form.submission_count} total submissions)\n`);

  // 2. Fetch submissions (newest first)
  const submissions = await netlifyGet(`/forms/${form.id}/submissions?per_page=20`);
  if (!submissions.length) {
    console.log('📭  No submissions yet.');
    process.exit(0);
  }

  // List submissions
  console.log('📋  Recent submissions:\n');
  submissions.slice(0, 10).forEach((s, i) => {
    const name = s.data.contact_name || '(no name)';
    const date = new Date(s.created_at).toLocaleString();
    console.log(`  [${i}] ${name.padEnd(28)} ${date}`);
  });

  const choice = await prompt('\nWhich submission to apply? (enter number, default 0): ');
  const idx = parseInt(choice || '0', 10);
  const sub = submissions[idx];
  if (!sub) { console.error('❌  Invalid selection.'); process.exit(1); }

  const d = sub.data;

  // 3. Preview
  console.log('\n─────────────────────────────────────────');
  console.log('  SUBMISSION PREVIEW');
  console.log('─────────────────────────────────────────');
  console.log(`  Submitted by : ${d.contact_name || '—'}  (${d.contact_email || '—'})`);
  console.log(`  Ticket URL   : ${d.ticket_url || '(none)'}`);
  console.log(`  Logo files   : ${d.logo_files ? '✓ yes' : '(none)'}`);
  console.log(`  Event photos : ${d.event_photos ? '✓ yes' : '(none)'}`);
  console.log(`  Venue photos : ${d.venue_photos ? '✓ yes' : '(none)'}`);
  console.log(`  Drive link   : ${d.photos_drive_link || '(none)'}`);

  // Count speakers
  const speakerNums = [];
  for (let i = 1; i <= 20; i++) {
    if (d[`speaker_${i}_name`]) speakerNums.push(i);
  }
  console.log(`  Speakers     : ${speakerNums.length > 0 ? speakerNums.length + ' submitted' : '(none)'}`);
  speakerNums.forEach(n => console.log(`    • ${d[`speaker_${n}_name`]}${d[`speaker_${n}_topic`] ? ' — ' + d[`speaker_${n}_topic`] : ''}`));

  const sponsorNums = [];
  for (let i = 1; i <= 20; i++) {
    if (d[`sponsor_${i}_name`]) sponsorNums.push(i);
  }
  console.log(`  Sponsors     : ${sponsorNums.length > 0 ? sponsorNums.length + ' submitted' : '(none — existing list kept)'}`);
  sponsorNums.forEach(n => console.log(`    • ${d[`sponsor_${n}_name`]}`));

  if (d.content_updates) {
    console.log(`\n  Content notes:\n    ${d.content_updates}`);
  }
  console.log('─────────────────────────────────────────\n');

  const confirm = await prompt('Apply this submission and deploy? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('\nAborted. Nothing changed.\n');
    process.exit(0);
  }

  // 4. Load current site-data.json
  const dataPath = path.join(ROOT, 'site-data.json');
  let siteData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // 5. Apply ticket URL
  if (d.ticket_url) {
    siteData.ticket_url = d.ticket_url;
    console.log(`\n✓  Ticket URL updated → ${d.ticket_url}`);
  }

  // 6. Download logo if submitted
  if (d.logo_files) {
    const logoUrls = Array.isArray(d.logo_files) ? d.logo_files : [d.logo_files];
    const dest = path.join(ROOT, 'assets', 'logo' + ext(logoUrls[0]));
    console.log('\n⬇️   Downloading logo…');
    try {
      await downloadFile(logoUrls[0], dest);
      siteData.logo_path = '/assets/logo' + ext(logoUrls[0]);
      console.log(`✓  Logo saved → ${siteData.logo_path}`);
    } catch(e) { console.warn('⚠️   Logo download failed:', e.message); }
  }

  // 7. Download speaker headshots + build speaker entries
  if (speakerNums.length > 0) {
    const incoming = [];
    for (const n of speakerNums) {
      const speaker = {
        name:  d[`speaker_${n}_name`]  || '',
        title: d[`speaker_${n}_title`] || '',
        topic: d[`speaker_${n}_topic`] || '',
        bio:   d[`speaker_${n}_bio`]   || '',
        link:  d[`speaker_${n}_link`]  || '',
        photo: ''
      };
      const photoUrl = d[`speaker_${n}_photo`];
      if (photoUrl) {
        const filename = slugify(speaker.name) + ext(photoUrl);
        const dest = path.join(ROOT, 'assets', 'speakers', filename);
        process.stdout.write(`⬇️   Downloading headshot for ${speaker.name}… `);
        try {
          await downloadFile(photoUrl, dest);
          speaker.photo = `/assets/speakers/${filename}`;
          console.log('✓');
        } catch(e) { console.warn(`⚠️  failed (${e.message})`); }
      }
      incoming.push(speaker);
    }
    // Merge: add new speakers, skip duplicates (by name)
    const existingNames = new Set(siteData.speakers.map(s => s.name.toLowerCase()));
    let added = 0;
    incoming.forEach(s => {
      if (!existingNames.has(s.name.toLowerCase())) {
        siteData.speakers.push(s);
        added++;
      }
    });
    console.log(`✓  Speakers: ${added} added, ${incoming.length - added} already exist`);
  }

  // 8. Download sponsor logos + build sponsor entries
  if (sponsorNums.length > 0) {
    for (const n of sponsorNums) {
      const name    = d[`sponsor_${n}_name`] || '';
      const tag     = d[`sponsor_${n}_tag`]  || '';
      const website = d[`sponsor_${n}_website`] || '';
      const level   = d[`sponsor_${n}_level`]   || 'sponsor';
      let   logo    = '';

      const logoUrl = d[`sponsor_${n}_logo`];
      if (logoUrl) {
        const filename = slugify(name) + ext(logoUrl);
        const dest = path.join(ROOT, 'assets', 'sponsors', filename);
        process.stdout.write(`⬇️   Downloading logo for ${name}… `);
        try {
          await downloadFile(logoUrl, dest);
          logo = `/assets/sponsors/${filename}`;
          console.log('✓');
        } catch(e) { console.warn(`⚠️  failed (${e.message})`); }
      }

      // Update existing sponsor entry or append
      const existing = siteData.sponsors.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (tag)     existing.tag     = tag;
        if (website) existing.website = website;
        if (logo)    existing.logo    = logo;
        if (level)   existing.level   = level;
      } else {
        siteData.sponsors.push({ name, tag, level, logo, website });
      }
    }
    console.log(`✓  Sponsors updated`);
  }

  // 9. Write updated site-data.json
  fs.writeFileSync(dataPath, JSON.stringify(siteData, null, 2));
  console.log('\n✓  site-data.json written');

  // 10. Print any manual notes for the operator
  const notes = [d.content_updates, d.other_notes, d.promo_copy, d.photos_drive_link]
    .filter(Boolean);
  if (notes.length) {
    console.log('\n─────────────────────────────────────────');
    console.log('  MANUAL ACTION NEEDED');
    console.log('─────────────────────────────────────────');
    if (d.content_updates) console.log('\n📝 Content updates requested:\n   ' + d.content_updates);
    if (d.photos_drive_link) console.log('\n📁 Bulk photos Drive link:\n   ' + d.photos_drive_link);
    if (d.promo_copy) console.log('\n📣 Promo copy to review:\n   ' + d.promo_copy.slice(0, 300));
    if (d.other_notes) console.log('\n💬 Other notes:\n   ' + d.other_notes);
    console.log('─────────────────────────────────────────\n');
  }

  // 11. Deploy
  console.log('\n🚀  Deploying to production…\n');
  try {
    execSync(
      'NODE_TLS_REJECT_UNAUTHORIZED=0 netlify deploy --dir=. --prod',
      { cwd: ROOT, stdio: 'inherit' }
    );
    console.log('\n✅  Done! The site is live with the new assets.\n');
  } catch(e) {
    console.error('\n❌  Deploy failed. Run manually:\n    cd ' + ROOT + ' && netlify deploy --dir=. --prod\n');
  }
})();
