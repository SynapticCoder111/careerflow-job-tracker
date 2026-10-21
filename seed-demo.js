/**
 * Seeds a disposable demo account with applications and interview rounds so
 * every page can be explored locally.
 *
 *   node seed-demo.js --yes
 *
 * Safety rules:
 * - Development only. Refuses when NODE_ENV=production, and also when the
 *   target server reports a production environment or legacy adoption.
 * - Explicitly opt-in: it does nothing without --yes.
 * - No built-in password. One is generated and printed once. Set
 *   DEMO_PASSWORD only to re-seed an existing demo account.
 * - The demo user is an ordinary account: it can only read and modify records
 *   whose userId is its own, and seeding clears just those records.
 *
 * Env: DEMO_BASE_URL, DEMO_EMAIL, DEMO_PASSWORD.
 */
const crypto = require('crypto');

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.DEMO_EMAIL || 'demo@careerflow.app';
const PROVIDED_PASSWORD = process.env.DEMO_PASSWORD || '';
const CONFIRMED = process.argv.includes('--yes');

if (!CONFIRMED) {
  console.error('Refusing to seed: this creates a disposable demo account.');
  console.error('Re-run with --yes to confirm.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production (NODE_ENV=production).');
  process.exit(1);
}
if (process.env.ALLOW_LEGACY_ADOPTION === 'true') {
  console.error(
    'Refusing to seed while ALLOW_LEGACY_ADOPTION=true: the demo account could adopt ownerless records.'
  );
  process.exit(1);
}

function generatePassword() {
  // Guaranteed letter + digit, ~28 characters, 72+ bits of randomness.
  return (
    'demo-' +
    crypto.randomBytes(9).toString('base64url') +
    '-' +
    crypto.randomBytes(2).toString('hex') +
    '1a'
  );
}

const PASSWORD = PROVIDED_PASSWORD || generatePassword();

let cookie = '';

async function api(path, options = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, Object.assign({}, options, { headers }));
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc && sc.length) cookie = sc.map((s) => s.split(';')[0]).join('; ');
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

const APPLICATIONS = [
  { companyName: 'Nova Analytics', jobRole: 'Frontend Engineer', status: 'Interview', applicationDate: '2026-08-14', jobLink: 'https://nova.example.com/jobs/1', location: 'Bengaluru, India', workMode: 'Hybrid', employmentType: 'Full-time', jobSource: 'LinkedIn', priority: 'High', salaryMin: 1800000, salaryMax: 2400000, currency: 'INR', recruiterName: 'Priya Nair', recruiterEmail: 'priya@nova.example.com', followUpDate: '2026-10-18', interviewDate: '2026-10-22', notes: 'Focus on React and design systems. Referred by a former teammate.', tags: ['react', 'typescript', 'design-systems'] },
  { companyName: 'Helix Systems', jobRole: 'Backend Engineer (Node.js)', status: 'Assessment', applicationDate: '2026-08-28', jobLink: 'https://helix.example.com/jobs/2', location: 'Remote (India)', workMode: 'Remote', employmentType: 'Full-time', jobSource: 'Company Website', priority: 'High', salaryMin: 2000000, salaryMax: 2800000, currency: 'INR', deadline: '2026-10-21', notes: 'Coding round expected — graph algorithms and MongoDB aggregation.', tags: ['node', 'mongodb', 'system-design'] },
  { companyName: 'Zenith Digital', jobRole: 'Full Stack Developer', status: 'Applied', applicationDate: '2026-09-12', jobLink: 'https://zenith.example.com/jobs/3', location: 'Pune, India', workMode: 'On-site', employmentType: 'Full-time', jobSource: 'Referral', priority: 'Medium', recruiterName: 'Rohit Sharma', followUpDate: '2026-10-16', notes: 'Referred by Ananya. Good engineering culture, 5-day office.', tags: ['react', 'node', 'postgres'] },
  { companyName: 'Cobalt Fintech', jobRole: 'Machine Learning Engineer', status: 'Offer', applicationDate: '2026-07-20', jobLink: 'https://cobalt.example.com/jobs/4', location: 'Hyderabad, India', workMode: 'Hybrid', employmentType: 'Full-time', jobSource: 'Company Website', priority: 'High', salaryMin: 3000000, salaryMax: 4000000, currency: 'INR', notes: 'Offer received — negotiating the base and the joining bonus.', tags: ['python', 'ml', 'pytorch'] },
  { companyName: 'Vertex Mobility', jobRole: 'Android Engineer', status: 'Rejected', applicationDate: '2026-09-01', jobLink: 'https://vertex.example.com/jobs/5', location: 'Chennai, India', workMode: 'On-site', employmentType: 'Contract', jobSource: 'Job Portal', priority: 'Low', notes: 'Position filled internally. Keep the recruiter warm.', tags: ['android', 'kotlin'] },
  { companyName: 'Orbit Labs', jobRole: 'DevOps Engineer', status: 'Bookmarked', applicationDate: '2026-10-01', jobLink: 'https://orbit.example.com/jobs/6', location: 'Remote', workMode: 'Remote', employmentType: 'Full-time', jobSource: 'LinkedIn', priority: 'Medium', notes: 'Interesting role, but a referral is needed before applying.', tags: ['aws', 'kubernetes', 'terraform'] },
  { companyName: 'Aurora Health', jobRole: 'Software Engineer (Java)', status: 'Applied', applicationDate: '2026-09-25', jobLink: 'https://aurora.example.com/jobs/7', location: 'Mumbai, India', workMode: 'Hybrid', employmentType: 'Full-time', jobSource: 'Campus Placement', priority: 'Medium', followUpDate: '2026-10-19', notes: 'Campus drive converted to a full-time role.', tags: ['java', 'spring'] },
  { companyName: 'Nimbus Security', jobRole: 'Security Engineer', status: 'Withdrawn', applicationDate: '2026-06-30', jobLink: 'https://nimbus.example.com/jobs/8', location: 'Gurugram, India', workMode: 'On-site', employmentType: 'Full-time', jobSource: 'Other', priority: 'Low', notes: 'Withdrew — the relocation requirement was not feasible.', tags: ['security', 'pentest'] },
  { companyName: 'Pinewood Retail', jobRole: 'Senior Frontend Engineer', status: 'Interview', applicationDate: '2026-09-08', jobLink: 'https://pinewood.example.com/jobs/9', location: 'Bengaluru, India', workMode: 'Hybrid', employmentType: 'Full-time', jobSource: 'Job Portal', priority: 'Medium', followUpDate: '2026-10-20', interviewDate: '2026-10-24', notes: 'Second stage is a system design conversation.', tags: ['react', 'nextjs'] },
  { companyName: 'Meridian Capital', jobRole: 'Quantitative Developer', status: 'Assessment', applicationDate: '2026-09-30', jobLink: 'https://meridian.example.com/jobs/10', location: 'Mumbai, India', workMode: 'On-site', employmentType: 'Full-time', jobSource: 'Referral', priority: 'High', deadline: '2026-10-25', notes: 'Take-home on stochastic modelling. Deadline is firm.', tags: ['python', 'quant', 'c++'] },
];

const INTERVIEWS = [
  { company: 'Nova Analytics', type: 'Recruiter Screen', round: 'Recruiter Call', date: '2026-10-08', interviewer: 'Priya Nair', location: 'Zoom', topics: ['Company overview', 'Salary expectations'], questions: ['What does success look like in the first 90 days?', 'How is the team structured?'], checklist: ['Research the company', 'Prepare a 60-second intro', 'Prepare 3 questions', 'Test audio and video'], outcome: 'Passed', notes: 'Good energy. Asked thoughtful questions about the design system team.', next: 'Await the technical round scheduling.' },
  { company: 'Nova Analytics', type: 'Technical Interview', round: 'Round 2 — Technical', date: '2026-10-22', interviewer: 'Rahul Verma', location: 'Zoom', topics: ['React rendering', 'TypeScript generics', 'CSS architecture'], questions: ['How do you keep a design system consistent across teams?'], checklist: ['Review the job description', 'Prepare 2 system design examples', 'Test coding setup'], outcome: 'Pending', notes: 'Focus on component API design and state management.', next: 'Re-visit state management patterns before the call.' },
  { company: 'Helix Systems', type: 'Coding Round', round: 'Round 1 — Coding', date: '2026-10-24', interviewer: 'Vikram Iyer', location: 'Online assessment', topics: ['Graph algorithms', 'Time complexity', 'Mongoose aggregation'], questions: ['What does the team look for in a candidate?'], checklist: ['Revise graph traversal', 'Practice 2 medium problems', 'Prepare a test environment'], outcome: 'Pending', notes: 'Assessment is 90 minutes with two problems.', next: 'Book a mock interview slot this week.' },
  { company: 'Zenith Digital', type: 'HR Round', round: 'HR Discussion', date: '2026-10-14', interviewer: 'Ananya Desai', location: 'Pune office', topics: ['Notice period', 'Relocation'], questions: ['What is the notice period policy?'], checklist: ['Confirm documents'], outcome: 'Passed', notes: 'Positive. Waiting on their internal process.', next: 'Follow up in 5 working days.' },
  { company: 'Cobalt Fintech', type: 'Final Interview', round: 'Final Round', date: '2026-10-11', interviewer: 'Amit Bose', location: 'Hyderabad office', topics: ['Model deployment', 'MLOps', 'Leadership'], questions: ['How do you measure model quality in production?'], checklist: ['Prepare references', 'Review offer details'], outcome: 'Passed', notes: 'Panel was satisfied. Offer released the same day.', next: 'Respond to the offer and negotiate.' },
  { company: 'Pinewood Retail', type: 'System Design', round: 'Round 2 — System Design', date: '2026-10-24', interviewer: 'Sara Menon', location: 'Bengaluru office', topics: ['Component architecture', 'State management', 'Performance budgets'], questions: ['How would you structure a checkout flow?'], checklist: ['Sketch the architecture', 'Prepare 3 trade-off answers'], outcome: 'Pending', notes: 'Focus on data flow and trade-offs.', next: 'Draft the architecture diagram.' },
];

async function main() {
  // 0. Verify the target is a development server that may hold demo data.
  const health = await api('/api/health');
  if (health.status !== 200) {
    console.error('Server is not reachable at', BASE);
    process.exitCode = 1;
    return;
  }
  if (health.body?.environment === 'production') {
    console.error('Refusing to seed: the server reports a production environment.');
    process.exitCode = 1;
    return;
  }
  if (health.body?.demoSeedingAllowed === false) {
    console.error('Refusing to seed: demo seeding is disabled on this server.');
    process.exitCode = 1;
    return;
  }

  // 1. Create or sign in
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Demo Candidate', email: EMAIL, password: PASSWORD }),
  });

  if (reg.status === 409) {
    if (!PROVIDED_PASSWORD) {
      console.error('A demo account already exists for', EMAIL + '.');
      console.error('Set DEMO_PASSWORD to its password to re-seed it, or remove that account first.');
      process.exitCode = 1;
      return;
    }
    const login = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (login.status !== 200) {
      console.error('Could not sign in as', EMAIL, '—', login.body?.message);
      process.exitCode = 1;
      return;
    }
    console.log('Signed in as existing account:', EMAIL);
  } else if (reg.status !== 201) {
    console.error('Registration failed:', reg.body?.message);
    process.exitCode = 1;
    return;
  } else {
    console.log('Created account:', EMAIL);
  }

  // 2. Clear existing records for this account in one scoped operation.
  const cleared = await api('/api/applications', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
  if (cleared.status !== 200) {
    console.error('Could not clear existing data:', cleared.body?.message);
    process.exitCode = 1;
    return;
  }

  // 3. Seed applications
  const idByCompany = {};
  for (const app of APPLICATIONS) {
    const r = await api('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(app),
    });
    if (r.status === 201) idByCompany[app.companyName] = r.body.data.id;
    else console.error('  seed failed:', app.companyName, r.body?.message);
  }
  console.log('Seeded', Object.keys(idByCompany).length, 'applications');

  // 4. Seed interview rounds
  let ivCount = 0;
  for (const iv of INTERVIEWS) {
    const applicationId = idByCompany[iv.company];
    if (!applicationId) continue;
    const r = await api('/api/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId,
        interviewType: iv.type,
        round: iv.round,
        interviewDate: iv.date,
        interviewerName: iv.interviewer,
        location: iv.location,
        topicsToPrepare: iv.topics,
        questionsToAsk: iv.questions,
        personalNotes: iv.notes,
        nextSteps: iv.next,
        outcome: iv.outcome,
        preparationChecklist: iv.checklist.map((text, i) => ({
          text,
          done: iv.outcome === 'Passed' ? true : i === 0,
        })),
      }),
    });
    if (r.status === 201) ivCount++;
    else console.error('  seed failed:', iv.company, iv.type, r.body?.message);
  }
  console.log('Seeded', ivCount, 'interview rounds');

  console.log('\nDemo account (disposable; local development only)');
  console.log('  email:    ' + EMAIL);
  if (PROVIDED_PASSWORD) {
    console.log('  password: the DEMO_PASSWORD you supplied');
  } else {
    console.log('  password: ' + PASSWORD + '   (generated; shown once)');
  }
  console.log('  It sees only the demo records it created. Do not reuse a personal password.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exitCode = 1; });
