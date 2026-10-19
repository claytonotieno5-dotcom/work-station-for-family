const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-current-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(temporaryDirectory, 'data');
process.env.UPLOAD_DIR = path.join(temporaryDirectory, 'uploads');
process.env.STORAGE_PROVIDER = 'local';
process.env.VERCEL = '';
process.env.DATABASE_URL = '';
process.env.ELECTRICIAN_PASSWORD = 'test-electrician-password';
process.env.TAILOR_PASSWORD = 'test-tailor-password';
process.env.DEVELOPER_PASSWORD = 'test-developer-password';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
process.env.TRUST_PROXY = 'false';

const app = require('../index.js');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('Express app serves site routes and preserves form, upload, and authentication behavior', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  for (const route of ['/', '/electrician.html', '/tailoring.html', '/developer.html', '/favicon.svg', '/styles/home.css', '/js/main.js', '/images/tailor-profile.svg']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, `${route} should load`);
  }

  const dashboardWithoutSession = await fetch(`${baseUrl}/dashboard.html?role=electrician`, { redirect: 'manual' });
  assert.equal(dashboardWithoutSession.status, 302);
  assert.equal(dashboardWithoutSession.headers.get('location'), '/login.html');
  const notificationsWithoutSession = await fetch(`${baseUrl}/api/notifications?role=electrician`);
  assert.equal(notificationsWithoutSession.status, 401);

  const invalidEnquiry = await fetch(`${baseUrl}/enquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'role=electrician&contact_method=Email&customer_contact=invalid&customer_name=A&subject=B&message=C'
  });
  assert.equal(invalidEnquiry.status, 400);

  const electricianPage = await fetch(`${baseUrl}/electrician.html`);
  assert.equal(electricianPage.status, 200);
  const pageHtml = await electricianPage.text();
  assert.doesNotMatch(pageHtml, /name=["']budget["']/i);

  const enquiry = await fetch(`${baseUrl}/enquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      role: 'electrician',
      contact_method: 'Email',
      customer_contact: 'customer@example.com',
      customer_name: 'Test Customer',
      subject: 'Electrical repair',
      message: 'Please call to arrange a visit.',
      budget: '250000'
    }),
    redirect: 'manual'
  });
  assert.equal(enquiry.status, 302);
  assert.match(enquiry.headers.get('location'), /enquiry=sent/);
  const dataFile = path.join(temporaryDirectory, 'data', 'site-data.json');
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(data.enquiries.length, 1);
  assert.equal(data.enquiries[0].customer_name, 'Test Customer');
  assert.ok(!Object.prototype.hasOwnProperty.call(data.enquiries[0], 'budget'));

  const privateConversation = await fetch(`${baseUrl}/conversation`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      role: 'electrician',
      customer_name: 'Test Customer',
      customer_contact: 'customer@example.com',
      message: 'Please let me know when you can visit.'
    }),
    redirect: 'manual'
  });
  assert.equal(privateConversation.status, 302);
  const conversationData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const conversationId = conversationData.conversations[0].id;

  const login = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ role: 'electrician', password: process.env.ELECTRICIAN_PASSWORD }),
    redirect: 'manual'
  });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const dashboard = await fetch(`${baseUrl}/dashboard.html?role=electrician`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(dashboard.status, 200);
  const dashboardHtml = await dashboard.text();
  assert.match(dashboardHtml, /Enquiries \(1\)/);
  assert.match(dashboardHtml, /Notifications/);
  assert.match(dashboardHtml, /Security activity/);
  assert.match(dashboardHtml, /New inquiry: Electrical repair/);
  assert.match(dashboardHtml, /New private message from Test Customer/);

  const notificationResponse = await fetch(`${baseUrl}/api/notifications?role=electrician`, {
    headers: { Cookie: cookie }
  });
  assert.equal(notificationResponse.status, 200);
  assert.deepEqual(await notificationResponse.json(), {
    pending_inquiries: 1,
    unread_messages: 1,
    total: 2
  });
  const markRead = await fetch(`${baseUrl}/dashboard/electrician/mark-read`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: baseUrl,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ conversation_id: conversationId }),
    redirect: 'manual'
  });
  assert.equal(markRead.status, 302);
  const refreshedNotifications = await fetch(`${baseUrl}/api/notifications?role=electrician`, {
    headers: { Cookie: cookie }
  });
  assert.deepEqual(await refreshedNotifications.json(), {
    pending_inquiries: 1,
    unread_messages: 0,
    total: 1
  });
  const crossRoleNotifications = await fetch(`${baseUrl}/api/notifications?role=tailor`, {
    headers: { Cookie: cookie }
  });
  assert.equal(crossRoleNotifications.status, 401);

  const boundary = 'craft-current-test-boundary';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nTest project\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nAn uploaded test image.\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const upload = await fetch(`${baseUrl}/dashboard/electrician/upload-project`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: baseUrl,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: multipart,
    redirect: 'manual'
  });
  assert.equal(upload.status, 302);
  const updatedData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const uploadedImage = updatedData.projects.electrician[0].image;
  assert.match(uploadedImage, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const imageResponse = await fetch(`${baseUrl}${uploadedImage}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');

  const uploadDirectory = path.join(temporaryDirectory, 'uploads');
  fs.rmSync(uploadDirectory, { recursive: true, force: true });
  fs.writeFileSync(uploadDirectory, 'not a directory');
  const unavailableUpload = await fetch(`${baseUrl}/dashboard/electrician/upload-project`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: baseUrl,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: multipart,
    redirect: 'manual'
  });
  assert.equal(unavailableUpload.status, 503);
  fs.unlinkSync(uploadDirectory);

  const csrfRejected = await fetch(`${baseUrl}/dashboard/electrician/save`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'https://attacker.example',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'section=service&title=Invalid&description=Invalid',
    redirect: 'manual'
  });
  assert.equal(csrfRejected.status, 403);
  const auditData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.ok(auditData.security_events.some((event) => event.event === 'dashboard_request_origin_rejected'));
  assert.ok(auditData.security_events.every((event) => !Object.prototype.hasOwnProperty.call(event, 'password')));

  const logout = await fetch(`${baseUrl}/logout`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(logout.status, 302);
  const expiredDashboard = await fetch(`${baseUrl}/dashboard.html?role=electrician`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(expiredDashboard.status, 302);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failedLogin = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ role: 'electrician', password: 'incorrect-password' }),
      redirect: 'manual'
    });
    assert.equal(failedLogin.status, 401);
  }
  const rateLimitedLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ role: 'electrician', password: 'incorrect-password' }),
    redirect: 'manual'
  });
  assert.equal(rateLimitedLogin.status, 429);
  const finalAuditData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.ok(finalAuditData.security_events.some((event) => event.event === 'login_failed'));
  assert.ok(finalAuditData.security_events.some((event) => event.event === 'login_rate_limited'));
});

test('Vercel production config requires database and Blob but not local upload or proxy settings', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const handler = require('./server');
    handler.validateConfiguration();
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      VERCEL: '1',
      SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
      ELECTRICIAN_PASSWORD: 'test-electrician-password',
      TAILOR_PASSWORD: 'test-tailor-password',
      DEVELOPER_PASSWORD: 'test-developer-password',
      DATABASE_URL: 'postgresql:' + '//test:test@localhost:5432/test',
      BLOB_READ_WRITE_TOKEN: 'test-token',
      STORAGE_PROVIDER: '',
      UPLOAD_DIR: '',
      TRUST_PROXY: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
});

test('Vercel production config accepts managed Blob OIDC credentials without a static token', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const handler = require('./server');
    handler.validateConfiguration();
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      VERCEL: '1',
      SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
      ELECTRICIAN_PASSWORD: 'test-electrician-password',
      TAILOR_PASSWORD: 'test-tailor-password',
      DEVELOPER_PASSWORD: 'test-developer-password',
      DATABASE_URL: 'postgresql:' + '//test:test@localhost:5432/test',
      BLOB_READ_WRITE_TOKEN: '',
      BLOB_STORE_ID: 'test-store-id',
      VERCEL_OIDC_TOKEN: 'test-managed-oidc-token',
      STORAGE_PROVIDER: '',
      UPLOAD_DIR: '',
      TRUST_PROXY: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
});
