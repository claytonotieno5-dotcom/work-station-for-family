const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { after, before, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-current-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(temporaryDirectory, 'data');
process.env.UPLOAD_DIR = path.join(temporaryDirectory, 'uploads');
process.env.STORAGE_PROVIDER = 'local';
process.env.DATABASE_URL = '';
process.env.ELECTRICIAN_PASSWORD = 'test-electrician-password';
process.env.TAILOR_PASSWORD = 'test-tailor-password';
process.env.DEVELOPER_PASSWORD = 'test-developer-password';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
process.env.TRUST_PROXY = 'false';

const handler = require('../server.js');
const server = http.createServer(handler);
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('serves site routes, assets, health checks, forms, and protected owner sessions', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  for (const route of ['/', '/electrician.html', '/tailoring.html', '/developer.html', '/favicon.svg', '/styles/home.css']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, `${route} should load`);
  }

  const dashboardWithoutSession = await fetch(`${baseUrl}/dashboard.html?role=electrician`, { redirect: 'manual' });
  assert.equal(dashboardWithoutSession.status, 302);
  assert.equal(dashboardWithoutSession.headers.get('location'), '/login.html');

  const invalidEnquiry = await fetch(`${baseUrl}/enquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'role=electrician&contact_method=Email&customer_contact=invalid&customer_name=A&subject=B&message=C'
  });
  assert.equal(invalidEnquiry.status, 400);

  const enquiry = await fetch(`${baseUrl}/enquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      role: 'electrician',
      contact_method: 'Email',
      customer_contact: 'customer@example.com',
      customer_name: 'Test Customer',
      subject: 'Electrical repair',
      message: 'Please call to arrange a visit.'
    }),
    redirect: 'manual'
  });
  assert.equal(enquiry.status, 302);
  assert.match(enquiry.headers.get('location'), /enquiry=sent/);
  const data = JSON.parse(fs.readFileSync(path.join(temporaryDirectory, 'data', 'site-data.json'), 'utf8'));
  assert.equal(data.enquiries.length, 1);
  assert.equal(data.enquiries[0].customer_name, 'Test Customer');

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
  assert.match(await dashboard.text(), /Enquiries \(1\)/);

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
  const updatedData = JSON.parse(fs.readFileSync(path.join(temporaryDirectory, 'data', 'site-data.json'), 'utf8'));
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
});
