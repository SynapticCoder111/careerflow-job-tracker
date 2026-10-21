/**
 * CareerFlow — full workspace API test suite.
 * Registers a test account, then exercises every endpoint as that user.
 * Requires the server to be running.
 */
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

const EMAIL = `suite.${Date.now()}@example.com`;
const PASSWORD = 'test-only-' + crypto.randomBytes(6).toString('hex') + '-1a';
let cookie = '';

async function api(path, options = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, Object.assign({}, options, { headers }));
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc && sc.length) cookie = sc.map(s => s.split(';')[0]).join('; ');
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function main() {
  console.log('\n=== 1. AUTHENTICATION ===');
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Suite Runner', email: EMAIL, password: PASSWORD }),
  });
  check('register returns 201', reg.status === 201, reg.status);
  check('register sets a session cookie', !!cookie);

  const me = await api('/api/auth/me');
  check('me is authenticated', me.body?.authenticated === true);

  console.log('\n=== 2. APPLICATION CRUD ===');
  // Clear leftovers from earlier runs with the scoped bulk endpoint.
  await api('/api/applications', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
  const cleared = await api('/api/applications');
  check('workspace cleared', cleared.body.total === 0, cleared.body.total);

  const payload = {
    companyName: 'Test Industries', jobRole: 'Senior Backend Engineer', status: 'Applied',
    applicationDate: '2026-09-15', jobLink: 'https://example.com/jobs/1', location: 'Remote',
    workMode: 'Remote', employmentType: 'Full-time', jobSource: 'LinkedIn', priority: 'High',
    salaryMin: 120000, salaryMax: 160000, recruiterName: 'Jane Smith',
    recruiterEmail: 'jane@example.com', followUpDate: '2026-09-20',
    interviewDate: '2026-10-01', deadline: '2026-09-18', notes: 'Great team',
    tags: ['node', 'mongodb'],
    // A client must never be able to seed its own history.
    statusHistory: [{ from: 'Hacked', to: 'Offer', at: '2020-01-01T00:00:00.000Z' }],
  };
  const created = await api('/api/applications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  check('create returns 201', created.status === 201, created.status);
  check('create returns an id', !!created.body?.data?.id);
  check('create never returns _id', !created.body?.data?._id);
  const initialHistory = created.body?.data?.statusHistory;
  check('create records the initial status', initialHistory?.length === 1 && initialHistory[0].from === null && initialHistory[0].to === 'Applied', initialHistory);
  check('client-supplied history is ignored', initialHistory?.[0]?.from === null, initialHistory?.[0]?.from);
  check('history timestamp is a real instant', !Number.isNaN(Date.parse(initialHistory?.[0]?.at)), initialHistory?.[0]?.at);
  const id = created.body.data.id;

  const one = await api('/api/applications/' + id);
  check('read one returns 200', one.status === 200);
  check('read one keeps the id', one.body?.data?.id === id);
  check('read one stores tags', one.body?.data?.tags?.length === 2);
  check('read one keeps salaryMin', one.body?.data?.salaryMin === 120000);
  // Calendar dates are transferred as YYYY-MM-DD so no timezone can shift the day.
  check('application date is date-only', one.body?.data?.applicationDate === '2026-09-15', one.body?.data?.applicationDate);
  check('follow-up date is date-only', one.body?.data?.followUpDate === '2026-09-20', one.body?.data?.followUpDate);
  check('deadline is date-only', one.body?.data?.deadline === '2026-09-18', one.body?.data?.deadline);

  const updated = await api('/api/applications/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Interview', priority: 'Medium' }),
  });
  check('update returns 200', updated.status === 200);
  check('update changed the status', updated.body?.data?.status === 'Interview');
  check('update preserved the id', updated.body?.data?.id === id);
  check('update did not duplicate', updated.body?.data?.companyName === 'Test Industries');
  const history = updated.body?.data?.statusHistory;
  check('status change appends history', history?.length === 2, history?.length);
  check('history records from and to', history?.[1]?.from === 'Applied' && history?.[1]?.to === 'Interview', history?.[1]);

  const sameStatus = await api('/api/applications/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Interview', notes: 'No transition here' }),
  });
  check('re-saving the same status does not append', sameStatus.body?.data?.statusHistory?.length === 2, sameStatus.body?.data?.statusHistory?.length);

  const forged = await api('/api/applications/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statusHistory: [{ from: 'Fake', to: 'Offer', at: '2020-01-01T00:00:00.000Z' }] }),
  });
  check('client cannot rewrite status history', forged.body?.data?.statusHistory?.length === 2, forged.body?.data?.statusHistory?.length);

  console.log('\n=== 3. VALIDATION & ERRORS ===');
  const missing = await api('/api/applications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobRole: 'No company' }),
  });
  check('missing company -> 400', missing.status === 400, missing.status);
  check('field errors returned', !!missing.body?.errors?.companyName);

  const badEnum = await api('/api/applications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'X', jobRole: 'Y', status: 'Nonsense' }),
  });
  check('invalid enum -> 400', badEnum.status === 400, badEnum.status);

  const badId = await api('/api/applications/not-an-id');
  check('invalid ObjectId -> 400', badId.status === 400, badId.status);

  const missingRec = await api('/api/applications/000000000000000000000000');
  check('missing record -> 404', missingRec.status === 404, missingRec.status);

  const noRoute = await api('/api/nope');
  check('unknown route -> 404', noRoute.status === 404, noRoute.status);

  console.log('\n=== 4. SEARCH / FILTER / SORT / PAGINATE ===');
  // Remove the CRUD test record so the seed counts are exact.
  await api('/api/applications/' + id, { method: 'DELETE' });
  const seed = [
    { companyName: 'Alpha Corp', jobRole: 'Frontend Engineer', status: 'Applied', applicationDate: '2026-08-01', location: 'New York', workMode: 'On-site', employmentType: 'Full-time', jobSource: 'LinkedIn', priority: 'High', tags: ['react'] },
    { companyName: 'Beta Labs', jobRole: 'Backend Engineer', status: 'Interview', applicationDate: '2026-08-10', location: 'Austin', workMode: 'Remote', employmentType: 'Contract', jobSource: 'Referral', priority: 'Medium', tags: ['node'] },
    { companyName: 'Gamma Inc', jobRole: 'Data Scientist', status: 'Offer', applicationDate: '2026-08-20', location: 'Seattle', workMode: 'Hybrid', employmentType: 'Full-time', jobSource: 'Company Website', priority: 'High', tags: ['python', 'ml'] },
    { companyName: 'Delta Works', jobRole: 'QA Engineer', status: 'Rejected', applicationDate: '2026-09-01', location: 'Chicago', workMode: 'On-site', employmentType: 'Part-time', jobSource: 'Job Portal', priority: 'Low', tags: ['qa'] },
    { companyName: 'Epsilon Group', jobRole: 'DevOps Engineer', status: 'Bookmarked', applicationDate: '2026-09-05', location: 'Denver', workMode: 'Remote', employmentType: 'Full-time', jobSource: 'Campus Placement', priority: 'Medium', tags: ['aws'] },
  ];
  for (const s of seed) {
    const r = await api('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    if (r.status !== 201) check('seed ' + s.companyName, false, r.status);
  }
  const seeded = await api('/api/applications');
  check('5 records seeded', seeded.body.total === 5, seeded.body.total);

  check('search by company', (await api('/api/applications?search=Alpha')).body.total === 1);
  check('search by role', (await api('/api/applications?search=Engineer')).body.total === 4);
  check('search by location', (await api('/api/applications?search=Austin')).body.total === 1);
  check('search by tag', (await api('/api/applications?search=python')).body.total === 1);
  check('filter by status', (await api('/api/applications?status=Interview')).body.total === 1);
  check('filter by workMode', (await api('/api/applications?workMode=Remote')).body.total === 2);
  check('filter by employmentType', (await api('/api/applications?employmentType=Full-time')).body.total === 3);
  check('filter by jobSource', (await api('/api/applications?jobSource=Referral')).body.total === 1);
  check('filter by priority', (await api('/api/applications?priority=High')).body.total === 2);
  check('combined filters', (await api('/api/applications?status=Applied&priority=High')).body.total === 1);
  check('sort by company asc', (await api('/api/applications?sort=companyName:asc')).body.data[0].companyName === 'Alpha Corp');
  check('sort by company desc', (await api('/api/applications?sort=companyName:desc')).body.data[0].companyName === 'Gamma Inc');
  const paged = await api('/api/applications?page=1&limit=2');
  check('pagination limits results', paged.body.data.length === 2);
  check('pagination totalPages', paged.body.totalPages === 3, paged.body.totalPages);
  check('pagination last page', (await api('/api/applications?page=3&limit=2')).body.data.length === 1);
  // The client helper walks pages because one request is capped at 100 rows.
  check('limit is capped at 100', (await api('/api/applications?limit=1000')).body.limit === 100);
  check('page size honoured below the cap', (await api('/api/applications?limit=3')).body.data.length === 3);

  console.log('\n=== 5. ANALYTICS ===');
  const an = await api('/api/analytics/summary');
  check('analytics returns 200', an.status === 200);
  check('analytics total', an.body?.data?.totalApplications === 5);
  check('analytics byStatus', an.body?.data?.byStatus?.Applied === 1);
  check('analytics bySource', an.body?.data?.bySource?.Referral === 1);
  check('analytics states its denominator', an.body?.data?.interviewConversionDenominator === 4);
  check('analytics interview rate', an.body?.data?.interviewConversionRate === 25);
  check('analytics offer rate', an.body?.data?.offerConversionRate === 25);
  check('analytics response rate', an.body?.data?.responseRate === 50);
  check('analytics avg days to interview is null (no data)', an.body?.data?.averageDaysToInterview === null);
  check('analytics followUpsScheduled (seeds have none)', an.body?.data?.followUpsScheduled === 0, an.body?.data?.followUpsScheduled);
  check('analytics reports responded count', an.body?.data?.responded === 2, an.body?.data?.responded);
  check('analytics reports inProgress', an.body?.data?.inProgress === 2, an.body?.data?.inProgress);
  check('analytics exposes every breakdown the UI needs',
    !!an.body?.data?.byWorkMode && !!an.body?.data?.byEmploymentType && !!an.body?.data?.byPriority);
  check('analytics names past-due follow-ups honestly', an.body?.data?.followUpsPastDue === 0 && !('followUpsCompleted' in an.body.data));

  console.log('\n=== 6. INTERVIEWS ===');
  const appForInterview = (await api('/api/applications?limit=1')).body.data[0].id;
  const iv = await api('/api/interviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      applicationId: appForInterview, interviewType: 'Technical Interview', round: 'Round 1',
      interviewDate: '2026-11-05', interviewerName: 'Bob Smith', location: 'Zoom',
      topicsToPrepare: ['System Design'], questionsToAsk: ['Team structure?'],
      preparationChecklist: [{ text: 'Review JD', done: false }, { text: 'Test setup', done: true }],
    }),
  });
  check('interview create -> 201', iv.status === 201, iv.status);
  check('interview has an id', !!iv.body?.data?.id);
  check('interview hides _id', !iv.body?.data?._id);
  const ivId = iv.body.data.id;

  check('interview list', (await api('/api/interviews')).body.total === 1);
  check('interview filter by application', (await api('/api/interviews?applicationId=' + appForInterview)).body.total === 1);
  const ivUpd = await api('/api/interviews/' + ivId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: 'Passed' }) });
  check('interview update -> 200', ivUpd.status === 200);
  check('interview outcome updated', ivUpd.body?.data?.outcome === 'Passed');
  check('interview date is date-only', ivUpd.body?.data?.interviewDate === '2026-11-05', ivUpd.body?.data?.interviewDate);
  check('interview link preserved', ivUpd.body?.data?.applicationId === appForInterview);
  const ivPatch = await api('/api/interviews/' + ivId + '/checklist/0', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) });
  check('checklist toggle -> 200', ivPatch.status === 200);
  check('checklist item done', ivPatch.body?.data?.preparationChecklist?.[0]?.done === true);
  check('interview with missing app -> 404', (await api('/api/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: '000000000000000000000000', interviewType: 'HR Round', interviewDate: '2026-11-06' }) })).status === 404);
  check('interview without appId -> 400', (await api('/api/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interviewType: 'HR Round', interviewDate: '2026-11-06' }) })).status === 400);
  check('interview bad type -> 400', (await api('/api/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: appForInterview, interviewType: 'Bogus', interviewDate: '2026-11-06' }) })).status === 400);

  console.log('\n=== 7. CASCADE DELETE ===');
  const before = (await api('/api/interviews')).body.total;
  check('1 interview before delete', before === 1);
  const del = await api('/api/applications/' + appForInterview, { method: 'DELETE' });
  check('application deleted', del.status === 200);
  check('cascade reports the removal', del.body?.deletedInterviews === 1, del.body?.deletedInterviews);
  check('no orphaned interviews', (await api('/api/interviews')).body.total === 0);

  console.log('\n=== 8. BULK DELETE (ALL DATA) ===');
  const noConfirm = await api('/api/applications', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  check('bulk delete without confirmation -> 400', noConfirm.status === 400, noConfirm.status);
  check('bulk delete returns CONFIRMATION_REQUIRED', noConfirm.body?.code === 'CONFIRMATION_REQUIRED', noConfirm.body?.code);
  check('records untouched after refused delete', (await api('/api/applications')).body.total === 4);

  const bulk = await api('/api/applications', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }),
  });
  check('bulk delete -> 200', bulk.status === 200, bulk.status);
  check('bulk delete reports applications removed', bulk.body?.deletedApplications === 4, bulk.body?.deletedApplications);
  check('bulk delete reports interviews removed', bulk.body?.deletedInterviews === 0, bulk.body?.deletedInterviews);
  check('no applications remain', (await api('/api/applications')).body.total === 0);
  check('no interviews remain', (await api('/api/interviews')).body.total === 0);

  console.log('\n=== 9. LOGOUT ===');
  const out = await api('/api/auth/logout', { method: 'POST' });
  check('logout -> 200', out.status === 200);
  const after = await api('/api/applications');
  check('session invalid after logout', after.status === 401, after.status);

  console.log('\n========================================');
  console.log('  PASSED: ' + pass + '   FAILED: ' + fail);
  console.log('========================================');
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL:', e.message); process.exitCode = 1; });
