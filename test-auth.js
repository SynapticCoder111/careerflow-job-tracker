/* Authentication + isolation test suite */
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { hashPassword, verifyPassword, needsRehash } = require('./server/utils/password');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = 'test-only-' + crypto.randomBytes(6).toString('hex') + '-1a';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

function jar() {
  return { cookie: null };
}
function headers(c) {
  return c.cookie ? { Cookie: c.cookie } : {};
}
function capture(res, c) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc && sc.length) c.cookie = sc.map(s => s.split(';')[0]).join('; ');
}

async function main() {
  console.log('\n=== 1. PUBLIC ROUTES (no auth needed) ===');
  for (const p of ['/', '/login', '/register']) {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    check(`${p} returns 200`, r.status === 200, r.status);
  }
  const landing = await (await fetch(BASE + '/')).text();
  check('landing is the marketing page', landing.includes('Your job search') && landing.includes('hero-title'));
  check('landing has FAQ', landing.includes('faq-item'));
  check('landing has demo', landing.includes('demo-tab'));
  check('landing has no fake testimonials', !landing.toLowerCase().includes('testimonial'));
  check('landing has no fake user counts', !/\d+[k+]?\s*(users|customers|companies using)/i.test(landing));

  const health = await (await fetch(BASE + '/api/health')).json();
  check('health reports the environment', typeof health.environment === 'string' && health.environment.length > 0, health.environment);
  check('health reports the demo seeding policy', typeof health.demoSeedingAllowed === 'boolean', health.demoSeedingAllowed);

  console.log('\n=== 2. PROTECTED PAGE REDIRECTS ===');
  for (const p of ['/dashboard', '/applications', '/pipeline', '/calendar', '/companies', '/interview-prep', '/analytics', '/settings']) {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    check(`${p} redirects to login when signed out`, r.status === 302 && (r.headers.get('location') || '').startsWith('/login'), r.status);
  }

  console.log('\n=== 3. PROTECTED API REJECTS ANONYMOUS ===');
  for (const p of ['/api/applications', '/api/interviews', '/api/analytics/summary']) {
    const r = await fetch(BASE + p);
    const b = await r.json();
    check(`${p} returns 401`, r.status === 401, r.status);
    check(`${p} says sign-in required`, /signed in/i.test(b.message || ''), b.message);
  }

  console.log('\n=== 4. REGISTRATION ===');
  const c1 = jar();
  const email = `alex.${Date.now()}@example.com`;
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alex Sharma', email, password: PASSWORD })
  });
  const regBody = await reg.json();
  capture(reg, c1);
  const regSetCookie = (reg.headers.getSetCookie ? reg.headers.getSetCookie() : []).join('; ');
  check('register returns 201', reg.status === 201, reg.status);
  check('register sets a session cookie', !!c1.cookie);
  check('register returns the user id', !!regBody.data?.id);
  check('register never returns a password hash', !JSON.stringify(regBody).includes('passwordHash'));

  // Duplicate email
  const dup = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alex Again', email, password: PASSWORD })
  });
  const dupBody = await dup.json();
  check('duplicate email returns 409', dup.status === 409, dup.status);
  check('duplicate email explains why', /already exists/i.test(dupBody.message || ''), dupBody.message);

  // Validation
  const weak = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', email: 'not-an-email', password: 'short' })
  });
  const weakBody = await weak.json();
  check('invalid registration returns 400', weak.status === 400, weak.status);
  check('invalid registration returns field errors', !!weakBody.errors && !!weakBody.errors.email && !!weakBody.errors.password);
  check('register without a body -> 400 (not 500)', (await fetch(BASE + '/api/auth/register', { method: 'POST' })).status === 400);

  console.log('\n=== 5. SESSION + DATA ISOLATION ===');
  const me = await fetch(BASE + '/api/auth/me', { headers: headers(c1) });
  const meBody = await me.json();
  check('me returns the signed-in user', meBody.authenticated === true && meBody.data.email === email);
  check('me never returns a password hash', !JSON.stringify(meBody).includes('passwordHash'));

  // Create an application as user 1
  const created = await fetch(BASE + '/api/applications', {
    method: 'POST', headers: { ...headers(c1), 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'User One Co', jobRole: 'Tester', status: 'Applied' })
  });
  const createdBody = await created.json();
  check('authenticated create works', created.status === 201, created.status);
  const appId = createdBody.data.id;

  // Register a second user
  const c2 = jar();
  const email2 = `sam.${Date.now()}@example.com`;
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sam Lee', email: email2, password: PASSWORD })
  }).then(r => capture(r, c2));

  const u2List = await (await fetch(BASE + '/api/applications', { headers: headers(c2) })).json();
  check('second user sees an empty workspace', u2List.total === 0, u2List.total);

  // Second user cannot read user 1's application
  const cross = await fetch(BASE + '/api/applications/' + appId, { headers: headers(c2) });
  check('second user cannot read another user record', cross.status === 404, cross.status);

  // Second user cannot update or delete it
  const crossPut = await fetch(BASE + '/api/applications/' + appId, {
    method: 'PUT', headers: { ...headers(c2), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Offer' })
  });
  check('second user cannot update another user record', crossPut.status === 404, crossPut.status);

  const crossDel = await fetch(BASE + '/api/applications/' + appId, { method: 'DELETE', headers: headers(c2) });
  check('second user cannot delete another user record', crossDel.status === 404, crossDel.status);

  // Interview rounds are private records too — including the ability to attach
  // a round to someone else's application.
  const ivCreated = await fetch(BASE + '/api/interviews', {
    method: 'POST', headers: { ...headers(c1), 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId: appId, interviewType: 'Technical Interview', interviewDate: '2026-11-05', round: 'Round 1' })
  });
  const ivBody = await ivCreated.json();
  check('owner can schedule an interview round', ivCreated.status === 201, ivCreated.status);
  const ivId = ivBody.data?.id;

  check('second user cannot read another user interview',
    (await fetch(BASE + '/api/interviews/' + ivId, { headers: headers(c2) })).status === 404);
  check('second user cannot update another user interview',
    (await fetch(BASE + '/api/interviews/' + ivId, {
      method: 'PUT', headers: { ...headers(c2), 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'Passed' })
    })).status === 404);
  check('second user cannot delete another user interview',
    (await fetch(BASE + '/api/interviews/' + ivId, { method: 'DELETE', headers: headers(c2) })).status === 404);
  check('second user cannot attach a round to another user application',
    (await fetch(BASE + '/api/interviews', {
      method: 'POST', headers: { ...headers(c2), 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: appId, interviewType: 'HR Round', interviewDate: '2026-11-06' })
    })).status === 404);

  // Bulk delete is scoped by userId: it succeeds for user 2 but removes nothing
  // that belongs to user 1.
  const crossBulk = await fetch(BASE + '/api/applications', {
    method: 'DELETE', headers: { ...headers(c2), 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' })
  });
  const crossBulkBody = await crossBulk.json();
  check('bulk delete reports zero for an empty workspace', crossBulk.status === 200 && crossBulkBody.deletedApplications === 0, crossBulkBody.deletedApplications);
  check('foreign bulk delete leaves other user data intact',
    (await (await fetch(BASE + '/api/applications/' + appId, { headers: headers(c1) })).json()).data?.companyName === 'User One Co');

  // User 1 still owns it
  const own = await fetch(BASE + '/api/applications/' + appId, { headers: headers(c1) });
  const ownBody = await own.json();
  check('owner still sees their record', own.status === 200 && ownBody.data.companyName === 'User One Co');

  // Analytics are scoped. The first account ever created adopts any records
  // that predate accounts (data is preserved, not deleted), so user 1 may own
  // more than the record it just created. User 2 must see none of it.
  const an1 = await (await fetch(BASE + '/api/analytics/summary', { headers: headers(c1) })).json();
  const an2 = await (await fetch(BASE + '/api/analytics/summary', { headers: headers(c2) })).json();
  check('analytics scoped to user 1 (owns its own records)', an1.data.totalApplications >= 1, an1.data.totalApplications);
  check('analytics scoped to user 2 (sees none of user 1 records)', an2.data.totalApplications === 0, an2.data.totalApplications);
  check('empty workspace returns null rates (no divide by zero)', an2.data.interviewConversionRate === null);

  console.log('\n=== 6. LOGIN + LOGOUT ===');
  const bad = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrong-password' })
  });
  const badBody = await bad.json();
  check('wrong password returns 401', bad.status === 401, bad.status);
  check('wrong password message is generic', /incorrect/i.test(badBody.message || ''), badBody.message);
  check('login without a body -> 400 (not 500)', (await fetch(BASE + '/api/auth/login', { method: 'POST' })).status === 400);

  const c3 = jar();
  const good = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  capture(good, c3);
  check('correct credentials return 200', good.status === 200, good.status);
  check('login sets a session cookie', !!c3.cookie);

  const authed = await fetch(BASE + '/api/applications', { headers: headers(c3) });
  check('session cookie grants access', authed.status === 200, authed.status);

  // Logout invalidates the session
  const out = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: headers(c3) });
  check('logout returns 200', out.status === 200, out.status);
  const afterOut = await fetch(BASE + '/api/applications', { headers: headers(c3) });
  check('session is invalid after logout', afterOut.status === 401, afterOut.status);

  console.log('\n=== 7. RATE LIMITING ===');
  const limitedEmail = `rate.${Date.now()}@example.com`;
  const tryLogin = (addr, pw) =>
    fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addr, password: pw })
    });

  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await tryLogin(limitedEmail, 'wrong-password')).status);
  check('first five failed logins return 401', statuses.slice(0, 5).every(s => s === 401), statuses);
  check('sixth failed login returns 429', statuses[5] === 429, statuses[5]);

  const blocked = await tryLogin(limitedEmail, 'wrong-password');
  check('blocked login carries Retry-After', Number(blocked.headers.get('retry-after')) > 0, blocked.headers.get('retry-after'));
  const blockedBody = await blocked.json();
  check('blocked login is machine-readable', blockedBody.code === 'RATE_LIMITED', blockedBody.code);
  check('blocked login does not reveal the account', !/password was|no such/i.test(blockedBody.message), blockedBody.message);

  // The budget is keyed by address + email, so other accounts keep working.
  check('another account is not blocked', (await tryLogin(email, 'wrong-password')).status === 401);

  // A correct password resets that account's failed-attempt budget.
  for (let i = 0; i < 3; i++) await tryLogin(email, 'wrong-password');
  const goodAgain = await tryLogin(email, PASSWORD);
  check('correct password still signs in during the window', goodAgain.status === 200, goodAgain.status);
  check('successful sign-in clears the failure budget', (await tryLogin(email, 'wrong-password')).status === 401);

  console.log('\n=== 8. PASSWORD STORAGE AND COOKIE FLAGS ===');
  // Verify via the API that the stored hash is not the plaintext
  const leaked = await (await fetch(BASE + '/api/auth/me', { headers: headers(c1) })).text();
  check('plaintext password never appears in a response', !leaked.includes(PASSWORD));

  const hash = hashPassword('unit-password-1');
  check('hash uses the current scrypt parameters', /^scrypt\$65536\$8\$2\$/.test(hash), hash.split('$').slice(0, 4).join('$'));
  check('correct password verifies', verifyPassword('unit-password-1', hash) === true);
  check('wrong password is rejected', verifyPassword('unit-password-2', hash) === false);
  check('tampered hash is rejected', verifyPassword('unit-password-1', hash.slice(0, -4) + 'AAAA') === false);
  check('malformed hash is rejected', verifyPassword('unit-password-1', 'scrypt$broken') === false);
  check('current hash needs no upgrade', needsRehash(hash) === false);

  const legacySalt = crypto.randomBytes(16);
  const legacyKey = crypto.scryptSync('legacy-password-1', legacySalt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024,
  });
  const legacyHash = `scrypt$16384$8$1$${legacySalt.toString('base64')}$${legacyKey.toString('base64')}`;
  check('legacy hashes still verify', verifyPassword('legacy-password-1', legacyHash) === true);
  check('legacy hash is flagged for upgrade', needsRehash(legacyHash) === true);

  check('session cookie is HttpOnly', /HttpOnly/i.test(regSetCookie));
  check('session cookie is SameSite=Lax', /SameSite=Lax/i.test(regSetCookie));
  check('session cookie is scoped to /', /Path=\//i.test(regSetCookie));

  console.log('\n=== 9. DEMO SEEDING GUARDS ===');
  const seedPath = path.join(__dirname, 'seed-demo.js');

  const noFlag = spawnSync(process.execPath, [seedPath], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_ENV: 'development', DEMO_BASE_URL: 'http://127.0.0.1:1' },
  });
  check('demo seeding refuses without --yes', noFlag.status !== 0, noFlag.status);
  check('refusal names the opt-in flag', /--yes/.test(noFlag.stderr || ''), noFlag.stderr);

  const prodSeed = spawnSync(process.execPath, [seedPath, '--yes'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  check('demo seeding refuses in production', prodSeed.status !== 0, prodSeed.status);
  check('production refusal is explicit', /production/i.test(prodSeed.stderr || ''), prodSeed.stderr);

  console.log('\n========================================');
  console.log('  PASSED: ' + pass + '   FAILED: ' + fail);
  console.log('========================================');
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e.message); process.exitCode = 1; });
