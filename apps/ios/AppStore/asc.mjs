#!/usr/bin/env node
/**
 * App Store Connect helper for NJ Scratch (no dependencies; Node 22+).
 *
 *   node apps/ios/AppStore/asc.mjs status          show app, version, builds and what's missing
 *   node apps/ios/AppStore/asc.mjs push            upload listing, categories, age rating, availability, price,
 *                                                  review details, screenshots, and select the newest valid build
 *   node apps/ios/AppStore/asc.mjs submit          submit the version for App Review (asks nothing; run deliberately)
 *
 * Credentials (never printed): ASC_KEY_ID, ASC_ISSUER_ID and the .p8 key at
 * ASC_KEY_PATH (default ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8).
 * Review contact details come from apps/ios/AppStore/review-contact.json (gitignored).
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE_ID = 'com.madramdesign.NJScratch';
const VERSION = '1.0';
const meta = JSON.parse(readFileSync(join(here, 'metadata.json'), 'utf8'));
const SCREENSHOT_SETS = [
  { dir: 'iphone-6.9', type: 'APP_IPHONE_67' }, // 6.9" display (1320×2868)
  { dir: 'ipad-13', type: 'APP_IPAD_PRO_3GEN_129' }, // 13" iPad (2064×2752)
];

// ---------- auth + HTTP ----------
const keyId = process.env.ASC_KEY_ID;
const issuer = process.env.ASC_ISSUER_ID;
if (!keyId || !issuer) {
  console.error('Set ASC_KEY_ID and ASC_ISSUER_ID.');
  process.exit(2);
}
const keyPath = process.env.ASC_KEY_PATH ?? join(homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`);
if (!existsSync(keyPath)) {
  console.error(`API key file not found: ${keyPath}`);
  process.exit(2);
}
const privateKey = createPrivateKey(readFileSync(keyPath));
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64({ iss: issuer, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const all = json.errors ?? [];
    const errs = all.slice(0, 5).map((e) => `${e.title}: ${e.detail}${e.source?.pointer ? ` (${e.source.pointer})` : ''}`).join('\n  ');
    const more = all.length > 5 ? `\n  …and ${all.length - 5} more` : '';
    throw new Error(`${method} ${path} → HTTP ${res.status}\n  ${errs || text.slice(0, 500)}${more}`);
  }
  return json;
}
const get = (p) => api('GET', p);
const patch = (type, id, attributes, relationships) => api('PATCH', `/v1/${type}/${id}`, { data: { type, id, ...(attributes && { attributes }), ...(relationships && { relationships }) } });
const rel = (type, id) => ({ data: { type, id } });

// ---------- lookups ----------
async function lookup() {
  const apps = await get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No App Store Connect app for ${BUNDLE_ID}.`);
  const versions = await get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`);
  const version = versions.data.find((v) => v.attributes.versionString === VERSION) ?? versions.data[0];
  const infos = await get(`/v1/apps/${app.id}/appInfos`);
  const info = infos.data.find((i) => !['READY_FOR_DISTRIBUTION', 'REPLACED_WITH_NEW_INFO'].includes(i.attributes.state ?? i.attributes.appStoreState)) ?? infos.data[0];
  return { app, version, info };
}

async function newestBuild(appId) {
  const builds = await get(`/v1/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${VERSION}&sort=-uploadedDate&limit=10`);
  return builds.data;
}

// ---------- push steps ----------
async function pushListing({ app, version, info }) {
  const locs = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  const loc = locs.data.find((l) => l.attributes.locale === meta.locale) ?? locs.data[0];
  await patch('appStoreVersionLocalizations', loc.id, {
    description: meta.description,
    keywords: meta.keywords,
    promotionalText: meta.promotionalText,
    marketingUrl: meta.marketingUrl,
    supportUrl: meta.supportUrl,
  });
  const infoLocs = await get(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  const infoLoc = infoLocs.data.find((l) => l.attributes.locale === meta.locale) ?? infoLocs.data[0];
  await patch('appInfoLocalizations', infoLoc.id, { subtitle: meta.subtitle, privacyPolicyUrl: meta.privacyPolicyUrl });
  await patch('appInfos', info.id, undefined, {
    primaryCategory: rel('appCategories', meta.primaryCategory),
    secondaryCategory: rel('appCategories', meta.secondaryCategory),
  });
  const versionAttrs = { releaseType: 'MANUAL' };
  if (meta.copyright) versionAttrs.copyright = meta.copyright;
  await patch('appStoreVersions', version.id, versionAttrs);
  if (meta.contentRightsDeclaration) await patch('apps', app.id, { contentRightsDeclaration: meta.contentRightsDeclaration });
  console.log('✓ listing text, URLs, categories, release type (manual)');
  return loc;
}

/** Answer "none" to every content question, "no" to every yes/no question, and set the 18+ override. */
async function pushAgeRating({ info }) {
  const decl = (await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
  const attrs = {};
  const skip = new Set(['kidsAgeBand', 'koreaAgeRatingOverride', 'gracRatingClassificationNumber', 'developerAgeRatingInfoUrl', 'ageRatingOverride', 'ageRatingOverrideV2', 'seventeenPlus', 'gamblingAndContests']);
  for (const [k, v] of Object.entries(decl.attributes)) {
    if (skip.has(k)) continue;
    if (typeof v === 'boolean' || ['gambling', 'lootBox', 'unrestrictedWebAccess', 'advertising', 'ageAssurance', 'healthOrWellnessTopics', 'messagingAndChat', 'parentalControls', 'userGeneratedContent'].includes(k)) attrs[k] = false;
    else if (v === null || typeof v === 'string') attrs[k] = 'NONE';
  }
  if ('ageRatingOverrideV2' in decl.attributes) attrs.ageRatingOverrideV2 = meta.ageRatingOverride;
  else if ('ageRatingOverride' in decl.attributes) attrs.ageRatingOverride = 'SEVENTEEN_PLUS';
  // Unanswered questions come back as null, so their type isn't known up front: retry with the type Apple reports.
  for (let attempt = 0; ; attempt++) {
    try {
      await patch('ageRatingDeclarations', decl.id, attrs);
      break;
    } catch (e) {
      const wrong = [...e.message.matchAll(/attribute '(\w+)'\. Expected a (BOOLEAN|STRING)/g)];
      if (!wrong.length || attempt >= 3) throw e;
      for (const [, k, t] of wrong) attrs[k] = t === 'BOOLEAN' ? false : 'NONE';
    }
  }
  console.log(`✓ age rating: no objectionable content; override ${attrs.ageRatingOverrideV2 ?? attrs.ageRatingOverride}`);
}

async function pushAvailability({ app }) {
  const existing = await get(`/v1/apps/${app.id}/appAvailabilityV2`).catch(() => null);
  if (existing?.data) {
    console.log('• availability already set (change it in App Store Connect if needed)');
    return;
  }
  // Apple expects every territory to be listed, each marked available or not.
  const territories = (await get('/v1/territories?limit=200')).data.map((t) => t.id);
  const included = territories.map((t, i) => ({
    type: 'territoryAvailabilities',
    id: `\${t${i}}`,
    attributes: { available: meta.availability.includes(t) },
    relationships: { territory: rel('territories', t) },
  }));
  await api('POST', '/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: false },
      relationships: { app: rel('apps', app.id), territoryAvailabilities: { data: included.map(({ type, id }) => ({ type, id })) } },
    },
    included,
  });
  console.log(`✓ availability: ${meta.availability.join(', ')}`);
}

async function pushPrice({ app }) {
  const existing = await get(`/v1/apps/${app.id}/appPriceSchedule`).catch(() => null);
  if (existing?.data) {
    // New apps get an empty schedule; only skip when a price is actually set.
    const prices = await get(`/v1/appPriceSchedules/${existing.data.id}/manualPrices?limit=1`).catch(() => ({ data: [] }));
    if (prices.data.length) {
      console.log('• price already set');
      return;
    }
  }
  const points = await get(`/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
  const free = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error('Could not find the free price point.');
  await api('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: rel('apps', app.id),
        baseTerritory: rel('territories', 'USA'),
        manualPrices: { data: [{ type: 'appPrices', id: '${price}' }] },
      },
    },
    included: [{ type: 'appPrices', id: '${price}', attributes: { startDate: null }, relationships: { appPricePoint: rel('appPricePoints', free.id) } }],
  });
  console.log('✓ price: free');
}

async function pushReviewDetails({ version }) {
  const contactPath = join(here, 'review-contact.json');
  if (!existsSync(contactPath)) {
    // Contact entered in App Store Connect: only keep the review notes up to date.
    const existing = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
    if (existing?.data) {
      await patch('appStoreReviewDetails', existing.data.id, { notes: meta.reviewNotes, demoAccountRequired: false });
      console.log('✓ review notes (contact kept as entered in App Store Connect)');
    } else {
      console.log('• review contact missing: enter it in App Store Connect or create apps/ios/AppStore/review-contact.json');
    }
    return;
  }
  const contact = JSON.parse(readFileSync(contactPath, 'utf8'));
  const attributes = { ...contact, demoAccountRequired: false, notes: meta.reviewNotes };
  const existing = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
  if (existing?.data) await patch('appStoreReviewDetails', existing.data.id, attributes);
  else await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: rel('appStoreVersions', version.id) } } });
  console.log('✓ review contact and notes');
}

async function uploadScreenshot(setId, file) {
  const bytes = readFileSync(file);
  const created = await api('POST', '/v1/appScreenshots', {
    data: { type: 'appScreenshots', attributes: { fileName: basename(file), fileSize: bytes.length }, relationships: { appScreenshotSet: rel('appScreenshotSets', setId) } },
  });
  for (const op of created.data.attributes.uploadOperations) {
    const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`Screenshot upload failed: HTTP ${res.status}`);
  }
  await patch('appScreenshots', created.data.id, { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') });
}

async function pushScreenshots(loc) {
  const sets = await get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`);
  for (const { dir, type } of SCREENSHOT_SETS) {
    const folder = join(here, 'screenshots', dir);
    const files = readdirSync(folder).filter((f) => f.endsWith('.png')).sort().map((f) => join(folder, f));
    let set = sets.data.find((s) => s.attributes.screenshotDisplayType === type);
    if (set) {
      // Replace what's there so re-running is safe.
      const shots = await get(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
      for (const s of shots.data) await api('DELETE', `/v1/appScreenshots/${s.id}`);
    } else {
      set = (await api('POST', '/v1/appScreenshotSets', {
        data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', loc.id) } },
      })).data;
    }
    for (const f of files) await uploadScreenshot(set.id, f);
    console.log(`✓ ${files.length} screenshots → ${type} (${(files.reduce((n, f) => n + statSync(f).size, 0) / 1e6).toFixed(1)} MB)`);
  }
}

async function selectBuild({ app, version }) {
  const builds = await newestBuild(app.id);
  const valid = builds.find((b) => b.attributes.processingState === 'VALID');
  if (!valid) {
    console.log(`• no processed build yet (${builds.map((b) => `${b.attributes.version}: ${b.attributes.processingState}`).join(', ') || 'none uploaded'}); run push again later`);
    return;
  }
  if (valid.attributes.usesNonExemptEncryption == null) await patch('builds', valid.id, { usesNonExemptEncryption: false });
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: valid.id } });
  console.log(`✓ build ${valid.attributes.version} selected for ${VERSION}`);
}

// ---------- commands ----------
async function status() {
  const ctx = await lookup();
  const { app, version, info } = ctx;
  console.log(`App: ${app.attributes.name} (${app.attributes.bundleId}, id ${app.id})`);
  console.log(`Version: ${version.attributes.versionString} — ${version.attributes.appStoreState ?? version.attributes.appVersionState}`);
  console.log(`App info state: ${info.attributes.state ?? info.attributes.appStoreState}`);
  const builds = await newestBuild(app.id);
  console.log(`Builds: ${builds.map((b) => `${b.attributes.version} ${b.attributes.processingState}`).join(', ') || 'none'}`);
  const selected = await get(`/v1/appStoreVersions/${version.id}/build`).catch(() => null);
  console.log(`Selected build: ${selected?.data?.attributes?.version ?? 'none'}`);
}

async function push() {
  const ctx = await lookup();
  const loc = await pushListing(ctx);
  await pushAgeRating(ctx);
  await pushAvailability(ctx);
  await pushPrice(ctx);
  await pushReviewDetails(ctx);
  await pushScreenshots(loc);
  await selectBuild(ctx);
  console.log('\nStill done in App Store Connect itself: App Privacy → "Data Not Collected" → Publish.');
}

async function submit() {
  const { app, version } = await lookup();
  const sub = await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: rel('apps', app.id) } } });
  await api('POST', '/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: rel('reviewSubmissions', sub.data.id), appStoreVersion: rel('appStoreVersions', version.id) } },
  });
  await patch('reviewSubmissions', sub.data.id, { submitted: true });
  console.log(`✓ ${VERSION} submitted for App Review (submission ${sub.data.id})`);
}

const cmd = process.argv[2];
async function ageFields() {
  const { info } = await lookup();
  const decl = (await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
  for (const [k, v] of Object.entries(decl.attributes)) console.log(`${k} = ${JSON.stringify(v)}`);
}
async function price() {
  const { app } = await lookup();
  const sched = await get(`/v1/apps/${app.id}/appPriceSchedule`).catch((e) => ({ error: e.message }));
  if (sched.error) return console.log(`no price schedule: ${sched.error.split('\n')[0]}`);
  const prices = await get(`/v1/appPriceSchedules/${sched.data.id}/manualPrices?include=appPricePoint,territory&limit=5`);
  const points = new Map((prices.included ?? []).filter((x) => x.type === 'appPricePoints').map((x) => [x.id, x.attributes.customerPrice]));
  for (const p of prices.data) console.log(`manual price: ${points.get(p.relationships.appPricePoint.data.id) ?? '?'} (territory ${p.relationships.territory?.data?.id ?? 'base'})`);
  if (!prices.data.length) console.log('price schedule exists but has no prices');
}
/** What a submission needs, read back from App Store Connect (personal contact details are not printed). */
async function check() {
  const { app, version, info } = await lookup();
  const v = (await get(`/v1/appStoreVersions/${version.id}`)).data.attributes;
  const loc = (await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data[0].attributes;
  const infoLoc = (await get(`/v1/appInfos/${info.id}/appInfoLocalizations`)).data[0].attributes;
  const review = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
  const r = review?.data?.attributes ?? {};
  const build = await get(`/v1/appStoreVersions/${version.id}/build`).catch(() => null);
  const appAttrs = (await get(`/v1/apps/${app.id}`)).data.attributes;
  const yes = (b) => (b ? '✓' : '✕');
  console.log(`${yes(v.copyright)} copyright: ${v.copyright ?? 'missing'}`);
  console.log(`${yes(r.contactFirstName && r.contactLastName && r.contactPhone && r.contactEmail)} review contact: ${['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'].map((k) => `${k.replace('contact', '')} ${r[k] ? 'set' : 'missing'}`).join(', ')}`);
  console.log(`${yes(r.notes)} review notes: ${r.notes ? `${r.notes.length} chars` : 'missing'}`);
  console.log(`${yes(loc.description && loc.keywords && loc.supportUrl)} description/keywords/support URL`);
  console.log(`${yes(infoLoc.privacyPolicyUrl)} privacy policy URL: ${infoLoc.privacyPolicyUrl ?? 'missing'}`);
  console.log(`${yes(build?.data)} build: ${build?.data?.attributes?.version ?? 'none'}`);
  console.log(`${yes(appAttrs.contentRightsDeclaration)} content rights: ${appAttrs.contentRightsDeclaration ?? 'missing'}`);
  console.log(`• release: ${v.releaseType}; state: ${v.appStoreState ?? v.appVersionState}`);
  console.log('• App Privacy can only be checked in App Store Connect (the API does not expose it).');
}
async function copyright() {
  const { version } = await lookup();
  await patch('appStoreVersions', version.id, { copyright: meta.copyright });
  console.log(`✓ copyright: ${meta.copyright}`);
}
const run = { copyright, status, push, submit, 'age-fields': ageFields, price, check, notes: async () => pushReviewDetails(await lookup()) }[cmd];
if (!run) {
  console.error('usage: asc.mjs status | push | submit');
  process.exit(2);
}
run().catch((e) => {
  console.error(`✕ ${e.message}`);
  process.exit(1);
});
