const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const rootDir = __dirname;
const localEnvFile = path.join(rootDir, '.env');
if (fs.existsSync(localEnvFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(localEnvFile);
}

function resolveConfiguredPath(value, defaultPath) {
  if (!value) return defaultPath;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(rootDir, value);
}

const publicDir = path.join(rootDir, 'public');
const dataDir = resolveConfiguredPath(process.env.DATA_DIR, path.join(rootDir, 'data'));
const uploadsDir = resolveConfiguredPath(process.env.UPLOAD_DIR, path.join(rootDir, 'uploads'));
const dataFile = path.join(dataDir, 'site-data.json');
const isProduction = process.env.NODE_ENV === 'production';
const isVercel = process.env.VERCEL === '1';
const trustProxy = process.env.TRUST_PROXY === 'true' || isVercel;
const storageProvider = String(process.env.STORAGE_PROVIDER || (isVercel ? 'blob' : 'local')).trim().toLowerCase();
const maxImageBytes = isVercel ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
const maxImageLabel = `${maxImageBytes / (1024 * 1024)} MB`;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const pool = process.env.DATABASE_URL
  ? new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      max: process.env.VERCEL === '1' ? 1 : 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      query_timeout: 10000,
      statement_timeout: 10000
    })
  : null;
let databaseReady;
const sessions = new Map();
const loginAttempts = new Map();

function validateRequiredEnvironment() {
  if (!['local', 'blob'].includes(storageProvider)) {
    const error = new Error('STORAGE_PROVIDER must be either "local" or "blob".');
    error.code = 'CONFIGURATION';
    throw error;
  }

  if (!isProduction) {
    return;
  }

  const requiredVars = ['SESSION_SECRET', 'ELECTRICIAN_PASSWORD', 'TAILOR_PASSWORD', 'DEVELOPER_PASSWORD', 'DATABASE_URL'];
  const missing = requiredVars.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (process.env.SESSION_SECRET && String(process.env.SESSION_SECRET).length < 32) {
    missing.push('SESSION_SECRET (at least 32 characters)');
  }
  const hasBlobOidcCredentials = process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN;
  if (storageProvider === 'blob' && !process.env.BLOB_READ_WRITE_TOKEN && !(isVercel && hasBlobOidcCredentials)) {
    missing.push('BLOB_READ_WRITE_TOKEN or Vercel Blob OIDC credentials (BLOB_STORE_ID and VERCEL_OIDC_TOKEN)');
  }
  if (storageProvider === 'local' && !process.env.UPLOAD_DIR) {
    missing.push('UPLOAD_DIR (persistent host volume path)');
  }
  if (process.env.DATABASE_URL) {
    try {
      const databaseUrl = new URL(process.env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) missing.push('DATABASE_URL (must use PostgreSQL)');
    } catch (error) {
      missing.push('DATABASE_URL (must be a valid PostgreSQL connection URL)');
    }
  }
  if (!isVercel && process.env.TRUST_PROXY !== 'true') {
    missing.push('TRUST_PROXY=true (required behind the host HTTPS proxy)');
  }
  if (isVercel && storageProvider !== 'blob') {
    const error = new Error('Vercel deployments require STORAGE_PROVIDER=blob and a BLOB_READ_WRITE_TOKEN.');
    error.code = 'CONFIGURATION';
    throw error;
  }
  if (missing.length > 0) {
    const error = new Error(`Missing required production environment variables: ${[...new Set(missing)].join(', ')}. See .env.example and README.md.`);
    error.code = 'CONFIGURATION';
    throw error;
  }
}

const roleNames = { electrician: 'Electrician', tailor: 'Tailor', developer: 'Developer' };
const passwords = {
  electrician: process.env.ELECTRICIAN_PASSWORD,
  tailor: process.env.TAILOR_PASSWORD,
  developer: process.env.DEVELOPER_PASSWORD
};

const defaultData = {
  profiles: {
    electrician: {
      name: 'Joseph Njoroge',
      title: 'Licensed Electrician & Maintenance Technician',
      photo: '/images/electrician-profile.svg',
      bio: 'Experienced electrician focused on safe residential and commercial electrical installations, repairs and maintenance work across the local service area.',
      location: 'Nairobi, Kenya',
      availability: 'Available for projects and maintenance work',
      experience_years: '7+',
      employment_type: 'Project-based',
      phone: '0721909801',
      whatsapp: '254721909801',
      email: 'electrician@craftandcurrent.co.ke',
      social: '',
      overview: 'Reliable electrical services for homes, small businesses and property managers.'
    },
    tailor: {
      name: 'Amina Wambui',
      title: 'Tailor & Fashion Designer',
      photo: '/images/tailor-profile.svg',
      bio: 'Tailoring specialist creating custom garments, repairs and alterations for clients who value fit, finish and personal style.',
      location: 'Nairobi, Kenya',
      availability: 'Open for custom orders and adjustments',
      experience_years: '6+',
      employment_type: 'Freelance',
      phone: '0721909802',
      whatsapp: '254721909802',
      email: 'tailor@craftandcurrent.co.ke',
      social: '',
      overview: 'Tailored garments, alterations and fittings designed around your lifestyle.'
    },
    developer: {
      name: 'Developer Name',
      title: 'Computer Science Student & Web Developer',
      photo: '/images/developer-profile.svg',
      bio: 'Student developer building responsive websites, business automation tools and custom web applications for small businesses and professionals.',
      location: 'Kenya',
      availability: 'Available for web and automation projects',
      experience_years: '2+',
      employment_type: 'Freelance',
      phone: '',
      whatsapp: '',
      email: 'developer@craftandcurrent.co.ke',
      social: 'https://github.com',
      overview: 'Professional digital products for growing local businesses.'
    }
  },
  services: {
    electrician: [
      { title: 'Residential electrical installations', description: 'From planning through wiring and commissioning for complete home electrical systems.' },
      { title: 'Wiring and rewiring', description: 'Safe wiring upgrades, installation repairs and reconfiguration for improved reliability.' },
      { title: 'Fault diagnosis and repairs', description: 'Quick testing and repair of failing circuits, appliance faults and power supply issues.' },
      { title: 'Lighting and socket installation', description: 'Interior and exterior lighting, switches, sockets and circuit additions.' }
    ],
    tailor: [
      { title: 'Custom clothing', description: 'Bespoke outfits created to fit your measurements, style and occasion.' },
      { title: 'Alterations and resizing', description: 'Precise resizing, adjustments and fit corrections to improve comfort and finish.' },
      { title: 'Hemming and fitting', description: 'Professional hemming and fitting services for dresses, trousers, skirts and uniforms.' },
      { title: 'Garment repairs', description: 'Mending and restyling for clothing that needs careful repair and finishing.' }
    ],
    developer: [
      { title: 'Business websites', description: 'Professional landing pages and service websites focused on trust and conversion.' },
      { title: 'Business automation', description: 'Workflow automations to reduce repeating admin work and improve service delivery.' },
      { title: 'Responsive redesigns', description: 'Updating older sites for mobile usability, clearer messaging and better performance.' }
    ]
  },
  projects: {
    electrician: [
      { title: 'Kitchen rewiring', description: 'Updated an old kitchen circuit layout for safer and more reliable power distribution.', category: 'Residential', image: '/images/project-electrical.svg' },
      { title: 'Lighting installation', description: 'Installed layered lighting and power points for a renovated living room area.', category: 'Lighting', image: '/images/project-electrical.svg' }
    ],
    tailor: [
      { title: 'Custom evening dress', description: 'Designed a bespoke dress with structured fit and tailored finishing.', category: 'Dressmaking', image: '/images/project-tailor.svg' },
      { title: 'Alteration and resizing', description: 'Adjusted premium garments to fit perfectly and improve comfort.', category: 'Alterations', image: '/images/project-tailor.svg' }
    ],
    developer: [
      { title: 'Family services website', description: 'A premium brochure and services platform built to showcase professional offerings and lead generation.', category: 'Web Development', image: '/images/project-developer.svg' }
    ]
  },
  enquiries: [],
  conversations: [],
  security_events: []
};

async function initializeDatabase() {
  if (!pool) {
    return;
  }
  if (!databaseReady) {
    databaseReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS application_state (
          state_key TEXT PRIMARY KEY,
          state_data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_sessions (
          token_hash TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS login_rate_limits (
          ip_hash TEXT PRIMARY KEY,
          window_started_at TIMESTAMPTZ NOT NULL,
          attempts INTEGER NOT NULL
        )
      `);
      await pool.query(
        'INSERT INTO application_state (state_key, state_data) VALUES ($1, $2::jsonb) ON CONFLICT (state_key) DO NOTHING',
        ['site', JSON.stringify(defaultData)]
      );
    })();
  }
  try {
    await databaseReady;
  } catch (error) {
    databaseReady = null;
    throw error;
  }
}

async function updateData(update) {
  if (!pool) {
    const data = await loadData();
    await update(data);
    await saveData(data);
    return data;
  }

  await initializeDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT state_data FROM application_state WHERE state_key = $1 FOR UPDATE',
      ['site']
    );
    if (result.rowCount !== 1) {
      throw new Error('Application data is not initialized in the database.');
    }
    const normalized = normalizeData(result.rows[0].state_data);
    await update(normalized.data);
    await client.query(
      'UPDATE application_state SET state_data = $1::jsonb, updated_at = NOW() WHERE state_key = $2',
      [JSON.stringify(normalized.data), 'site']
    );
    await client.query('COMMIT');
    return normalized.data;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalizeData(data) {
  let changed = false;
  data.profiles = data.profiles || JSON.parse(JSON.stringify(defaultData.profiles));
  data.enquiries = Array.isArray(data.enquiries) ? data.enquiries : [];
  data.services = data.services || {};
  data.projects = data.projects || {};
  data.conversations = Array.isArray(data.conversations) ? data.conversations : [];
  data.security_events = Array.isArray(data.security_events) ? data.security_events : [];
  for (const enquiry of data.enquiries) {
    if (!enquiry.id) {
      enquiry.id = crypto.randomBytes(12).toString('hex');
      changed = true;
    }
    if (!enquiry.status) {
      enquiry.status = 'Received';
      enquiry.status_history = Array.isArray(enquiry.status_history) ? enquiry.status_history : [{ status: 'Received', created_at: enquiry.created_at || new Date().toISOString() }];
      enquiry.responses = Array.isArray(enquiry.responses) ? enquiry.responses : [];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(enquiry, 'budget')) {
      delete enquiry.budget;
      changed = true;
    }
    if (!Array.isArray(enquiry.status_history)) {
      enquiry.status_history = [{ status: enquiry.status, created_at: enquiry.created_at || new Date().toISOString() }];
      changed = true;
    }
    if (!Array.isArray(enquiry.responses)) {
      enquiry.responses = [];
      changed = true;
    }
    if (!enquiry.updated_at) {
      enquiry.updated_at = enquiry.created_at || new Date().toISOString();
      changed = true;
    }
    if (enquiry.status_history.length && enquiry.status_history[enquiry.status_history.length - 1].status !== enquiry.status) {
      enquiry.status_history.push({ status: enquiry.status, created_at: enquiry.updated_at || new Date().toISOString() });
      changed = true;
    }
  }
  for (const role of Object.keys(roleNames)) {
    data.services[role] = Array.isArray(data.services[role]) ? data.services[role] : [];
    data.projects[role] = Array.isArray(data.projects[role]) ? data.projects[role] : [];
    data.projects[role].forEach((project) => {
      if (!project.id) {
        project.id = crypto.randomBytes(12).toString('hex');
        changed = true;
      }
      if (!Array.isArray(project.comments)) {
        project.comments = [];
        changed = true;
      }
    });
  }
  for (const conversation of data.conversations) {
    if (!Array.isArray(conversation.messages)) {
      conversation.messages = [];
      changed = true;
    }
    if (!Array.isArray(conversation.participants)) {
      conversation.participants = [];
      changed = true;
    }
  }
  return { data, changed };
}

function getConfiguredTimezone() {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function formatDateKey(date, timeZone = getConfiguredTimezone()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function dateKeyToUtc(dateKey) {
  const [year, month, day] = String(dateKey || '1970-01-01').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function daysBetween(dateA, dateB) {
  const ms = dateKeyToUtc(dateA).getTime() - dateKeyToUtc(dateB).getTime();
  return Math.round(ms / 86400000);
}

function buildUsageStatistics(data) {
  const timezone = getConfiguredTimezone();
  const allInquiries = Array.isArray(data.enquiries) ? data.enquiries : [];
  const todayKey = formatDateKey(new Date(), timezone);
  const thisMonth = new Date();
  const countInRange = (predicate) => allInquiries.filter((inquiry) => {
    const createdAt = inquiry.created_at ? new Date(inquiry.created_at) : null;
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return false;
    return predicate(createdAt, inquiry);
  }).length;

  const totalUsers = Object.keys(data.profiles || {}).length;
  const totalInquiries = allInquiries.length;
  const todayInquiries = countInRange((date) => formatDateKey(date, timezone) === todayKey);
  const thisWeek = countInRange((date) => Math.abs(daysBetween(formatDateKey(date, timezone), todayKey)) <= 6);
  const thisMonthCount = countInRange((date) => {
    const created = date.getTime();
    return created >= new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1).getTime() && created <= thisMonth.getTime();
  });
  const thisYearCount = countInRange((date) => {
    const yearStart = new Date(thisMonth.getFullYear(), 0, 1);
    const yearEnd = new Date(thisMonth.getFullYear(), 11, 31, 23, 59, 59, 999);
    return date.getTime() >= yearStart.getTime() && date.getTime() <= yearEnd.getTime();
  });

  const dailyTrend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = formatDateKey(date, timezone);
    const value = allInquiries.filter((inquiry) => inquiry.created_at && formatDateKey(new Date(inquiry.created_at), timezone) === key).length;
    return { label: `${date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: timezone })}`, value };
  });

  const weeklyTrend = Array.from({ length: 8 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (7 * (7 - index)));
    const startKey = formatDateKey(date, timezone);
    const endDate = new Date(date);
    endDate.setDate(date.getDate() + 6);
    const endKey = formatDateKey(endDate, timezone);
    const value = allInquiries.filter((inquiry) => {
      if (!inquiry.created_at) return false;
      const inquiryDateKey = formatDateKey(new Date(inquiry.created_at), timezone);
      return daysBetween(inquiryDateKey, startKey) >= 0 && daysBetween(inquiryDateKey, endKey) <= 0;
    }).length;
    return { label: `${startKey.slice(5)}–${endKey.slice(5)}`, value };
  }).slice(1);

  const monthlyTrend = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (11 - index));
    const label = date.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: timezone });
    const value = allInquiries.filter((inquiry) => {
      if (!inquiry.created_at) return false;
      const inquiryDate = new Date(inquiry.created_at);
      return inquiryDate.getFullYear() === date.getFullYear() && inquiryDate.getMonth() === date.getMonth();
    }).length;
    return { label, value };
  });

  const yearlyTrend = Array.from({ length: 5 }, (_, index) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - (4 - index));
    const label = String(date.getFullYear());
    const value = allInquiries.filter((inquiry) => {
      if (!inquiry.created_at) return false;
      const inquiryDate = new Date(inquiry.created_at);
      return inquiryDate.getFullYear() === date.getFullYear();
    }).length;
    return { label, value };
  });

  return {
    timezone,
    registered_users: totalUsers,
    total_inquiries: totalInquiries,
    inquiries_today: todayInquiries,
    inquiries_this_week: thisWeek,
    inquiries_this_month: thisMonthCount,
    inquiries_this_year: thisYearCount,
    trends: {
      daily: dailyTrend,
      weekly: weeklyTrend,
      monthly: monthlyTrend,
      yearly: yearlyTrend
    }
  };
}

async function loadData() {
  let data;
  if (pool) {
    await initializeDatabase();
    const result = await pool.query(
      'SELECT state_data FROM application_state WHERE state_key = $1',
      ['site']
    );
    if (result.rowCount !== 1) {
      throw new Error('Application data is not initialized in the database.');
    }
    data = result.rows[0].state_data;
  } else {
    try {
      data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Unable to load local site content: ${error.message}`);
      }
      data = JSON.parse(JSON.stringify(defaultData));
      await saveData(data);
    }
  }

  const normalized = normalizeData(data);
  if (normalized.changed) {
    await saveData(normalized.data);
  }
  return normalized.data;
}

async function saveData(data) {
  if (pool) {
    await initializeDatabase();
    await pool.query(
      `INSERT INTO application_state (state_key, state_data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET state_data = EXCLUDED.state_data, updated_at = NOW()`,
      ['site', JSON.stringify(data)]
    );
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const temporaryFile = `${dataFile}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryFile, dataFile);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Unable to clean up temporary data file:', cleanupError.code || cleanupError.name);
    }
    throw new Error(`Unable to persist local site content: ${error.message}`);
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function phoneHref(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function whatsappNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  return digits;
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      try {
        result[name] = decodeURIComponent(rest.join('='));
      } catch (error) {
        result[name] = '';
      }
    }
  }
  return result;
}

async function getSession(req) {
  const value = parseCookies(req.headers.cookie).sessionId;
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;

  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch (error) {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
  if (!roleNames[session.role] || typeof session.id !== 'string' || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
  if (pool) {
    await initializeDatabase();
    const result = await pool.query(
      'SELECT role FROM app_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [crypto.createHash('sha256').update(session.id).digest('hex')]
    );
    if (result.rowCount !== 1 || result.rows[0].role !== session.role) return null;
  } else if (sessions.get(session.id) !== session.role) {
    return null;
  }
  return session;
}

function isSecureRequest(req) {
  const forwardedProtocol = trustProxy
    ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
    : '';
  return Boolean(req.socket.encrypted) || forwardedProtocol === 'https';
}

function isSameOriginRequest(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const expectedProtocol = isSecureRequest(req) ? 'https:' : 'http:';
  try {
    const actual = new URL(origin);
    return actual.host.toLowerCase() === expectedHost && actual.protocol === expectedProtocol;
  } catch (error) {
    return false;
  }
}

async function setSession(res, role, secure) {
  const session = { id: crypto.randomBytes(32).toString('hex'), role, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  if (pool) {
    await initializeDatabase();
    await pool.query('DELETE FROM app_sessions WHERE expires_at <= NOW()');
    await pool.query(
      'INSERT INTO app_sessions (token_hash, role, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))',
      [crypto.createHash('sha256').update(session.id).digest('hex'), role, session.expiresAt]
    );
  } else {
    sessions.set(session.id, role);
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  res.setHeader('Set-Cookie', `sessionId=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? '; Secure' : ''}`);
}

async function recordLoginAttempt(req) {
  const forwardedAddress = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
  const address = forwardedAddress || req.socket.remoteAddress || 'unknown';
  const ipHash = crypto.createHmac('sha256', sessionSecret).update(address).digest('hex');

  if (pool) {
    await initializeDatabase();
    await pool.query("DELETE FROM login_rate_limits WHERE window_started_at < NOW() - INTERVAL '1 day'");
    const result = await pool.query(
      `INSERT INTO login_rate_limits (ip_hash, window_started_at, attempts)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (ip_hash) DO UPDATE SET
         attempts = CASE
           WHEN login_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
           ELSE login_rate_limits.attempts + 1
         END,
         window_started_at = CASE
           WHEN login_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
           ELSE login_rate_limits.window_started_at
         END
       RETURNING attempts`,
      [ipHash]
    );
    return result.rows[0].attempts <= 10;
  }

  const now = Date.now();
  const previous = loginAttempts.get(ipHash);
  const current = !previous || now - previous.windowStartedAt >= 15 * 60 * 1000
    ? { windowStartedAt: now, attempts: 1 }
    : { ...previous, attempts: previous.attempts + 1 };
  loginAttempts.set(ipHash, current);
  return current.attempts <= 10;
}

async function clearLoginAttempts(req) {
  const forwardedAddress = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
  const address = forwardedAddress || req.socket.remoteAddress || 'unknown';
  const ipHash = crypto.createHmac('sha256', sessionSecret).update(address).digest('hex');
  if (pool) {
    await pool.query('DELETE FROM login_rate_limits WHERE ip_hash = $1', [ipHash]);
  } else {
    loginAttempts.delete(ipHash);
  }
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new Error('Request too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function parseFormData(raw) {
  const result = {};
  if (!raw) return result;
  for (const [key, value] of new URLSearchParams(raw.toString('utf8'))) {
    result[key] = value;
  }
  return result;
}

function parseMultipartData(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundaryMatch) throw new Error('Missing multipart form boundary');

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const result = { fields: {}, file: null };
  let offset = 0;

  while (offset < buffer.length) {
    const partStart = buffer.indexOf(boundary, offset);
    if (partStart < 0) break;
    const headersStart = partStart + boundary.length + 2;
    if (buffer.subarray(partStart + boundary.length, headersStart).toString() === '--') break;

    const headersEnd = buffer.indexOf('\r\n\r\n', headersStart);
    if (headersEnd < 0) break;
    const partEnd = buffer.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headersEnd + 4);
    if (partEnd < 0) break;

    const headers = buffer.subarray(headersStart, headersEnd).toString('utf8');
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headers);
    const fieldName = disposition && /name="([^"]*)"/i.exec(disposition[1]);
    const filename = disposition && /filename="([^"]*)"/i.exec(disposition[1]);
    const content = buffer.subarray(headersEnd + 4, partEnd);

    if (fieldName) {
      if (filename && filename[1]) {
        const mimeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
        result.file = {
          fieldName: fieldName[1],
          originalName: path.basename(filename[1].replace(/\\/g, '/')),
          mimeType: mimeMatch ? mimeMatch[1].trim().toLowerCase() : '',
          buffer: content
        };
      } else {
        result.fields[fieldName[1]] = content.toString('utf8');
      }
    }
    offset = partEnd + 2;
  }
  return result;
}

function validateUploadedImage(file) {
  const extensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  };
  const extension = extensions[file.mimeType];
  if (!extension) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  const originalName = String(file.originalName || '');
  const suppliedExtension = path.extname(originalName).toLowerCase();
  const allowedExtensions = file.mimeType === 'image/jpeg' ? ['.jpg', '.jpeg'] : [extension];
  if (!originalName || originalName.length > 255 || /[\0\r\n]/.test(originalName) || !allowedExtensions.includes(suppliedExtension)) {
    throw new Error('The selected filename does not match its image type.');
  }
  if (file.buffer.length === 0 || file.buffer.length > maxImageBytes) {
    throw new Error(`Images must be smaller than ${maxImageLabel}.`);
  }
  const isJpeg = file.mimeType === 'image/jpeg' && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  const isPng = file.mimeType === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = file.mimeType === 'image/webp' && file.buffer.toString('ascii', 0, 4) === 'RIFF' && file.buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    throw new Error('The selected file does not match its JPEG, PNG, or WebP image type.');
  }
  return extension;
}

async function saveUploadedImage(file) {
  const extension = validateUploadedImage(file);
  const filename = `${crypto.randomBytes(16).toString('hex')}${extension}`;

  if (storageProvider === 'blob') {
    try {
      const { put } = require('@vercel/blob');
      const result = await put(filename, file.buffer, {
        access: 'public',
        contentType: file.mimeType,
        addRandomSuffix: false
      });
      return result.url;
    } catch (error) {
      console.error('Blob storage upload failed:', error.code || error.name || 'unknown error');
      const storageError = new Error('Image storage is unavailable. Check the storage configuration and try again.');
      storageError.code = 'STORAGE_UNAVAILABLE';
      throw storageError;
    }
  }

  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, filename), file.buffer, { flag: 'wx' });
    return `/uploads/${filename}`;
  } catch (error) {
    console.error('Local upload failed:', error.code || error.name || 'unknown error');
    const storageError = new Error('Image storage is unavailable at the moment. Please try again later.');
    storageError.code = 'STORAGE_UNAVAILABLE';
    throw storageError;
  }
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendHtml(res, html, status = 200) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, body, status = 200) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function normalizeMessageText(value, maxLength = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildConversationSummary(conversation, role) {
  const unreadCount = (conversation.messages || []).filter((message) => {
    if (message.sender === role) return false;
    return !Array.isArray(message.read_by) || !message.read_by.includes(role);
  }).length;
  return {
    id: conversation.id,
    role: conversation.role,
    customer_name: conversation.customer_name,
    customer_contact: conversation.customer_contact,
    updated_at: conversation.updated_at || conversation.created_at,
    unread_count: unreadCount,
    messages: conversation.messages || []
  };
}

function getSecuritySourceHash(req) {
  const forwardedAddress = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
  const address = forwardedAddress || req.socket.remoteAddress || 'unknown';
  return crypto.createHmac('sha256', sessionSecret).update(address).digest('hex').slice(0, 16);
}

async function recordSecurityEvent(req, event, role = '') {
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    event,
    role: roleNames[role] ? role : 'unknown',
    source_hash: getSecuritySourceHash(req),
    created_at: new Date().toISOString()
  };
  await updateData((data) => {
    data.security_events = Array.isArray(data.security_events) ? data.security_events : [];
    data.security_events.push(entry);
    if (data.security_events.length > 500) data.security_events.splice(0, data.security_events.length - 500);
  });
}

function countUnreadMessages(conversation, role) {
  return (conversation.messages || []).filter((message) =>
    message.sender !== role &&
    (!Array.isArray(message.read_by) || !message.read_by.includes(role))
  ).length;
}

async function renderHomePage() {
  const data = await loadData();
  const projectCards = ['electrician', 'tailor']
    .flatMap((role) => (data.projects[role] || []).slice(0, 2))
    .map((project) => `
      <article class="project-card reveal">
        <div class="project-image" style="background-image: url('${escapeHtml(project.image)}');"></div>
        <div class="project-copy">
          <span class="panel-tag">${escapeHtml(project.category || 'Project')}</span>
          <h3>${escapeHtml(project.title)}</h3>
          <p>${escapeHtml(project.description)}</p>
        </div>
      </article>
    `)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>Craft & Current — Professional Services</title>
  <meta name="description" content="Craft & Current connects homeowners and businesses with trusted electrical and tailoring professionals, plus a developer portfolio." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles/tokens.css" />
  <link rel="stylesheet" href="/styles/reset.css" />
  <link rel="stylesheet" href="/styles/global.css" />
  <link rel="stylesheet" href="/styles/layout.css" />
  <link rel="stylesheet" href="/styles/components.css" />
  <link rel="stylesheet" href="/styles/home.css" />
  <link rel="stylesheet" href="/styles/electrician.css" />
  <link rel="stylesheet" href="/styles/tailoring.css" />
  <link rel="stylesheet" href="/styles/developer.css" />
  <link rel="stylesheet" href="/styles/dashboard.css" />
  <link rel="stylesheet" href="/styles/animations.css" />
  <link rel="stylesheet" href="/styles/responsive.css" />
</head>
<body>
  <header class="site-header">
    <div class="container nav-shell">
      <a class="brand" href="/" aria-label="Craft & Current home"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></a>
      <nav class="main-nav" aria-label="Main navigation">
        <a href="/">Home</a>
        <a href="/electrician.html">Electrician</a>
        <a href="/tailoring.html">Tailoring</a>
        <a href="/developer.html">Developer</a>
        <a href="/#contact">Contact</a>
      </nav>
      <div class="nav-actions">
        <a class="btn btn-secondary" href="/login.html">Owner Login</a>
        <a class="btn btn-primary" href="/#contact">Make an enquiry</a>
      </div>
    </div>
  </header>

  <div class="intro-overlay" id="introOverlay" aria-live="polite">
    <div class="intro-panel">
      <p class="eyebrow">Craft & Current</p>
      <h1>Welcome and have access to premium services</h1>
      <button class="btn btn-primary" id="skipIntro" type="button">Skip introduction</button>
    </div>
  </div>

  <main>
    <section class="hero hero-home">
      <div class="container hero-inner">
        <div class="hero-copy reveal">
          <p class="eyebrow">Professional craftsmanship</p>
          <h1>Premium service, honest work and dependable results.</h1>
          <p class="lede">From electrical installations and repairs to bespoke tailoring and digital solutions, our platform connects clients with reliable professionals and real expertise.</p>
          <div class="cta-row">
            <a class="btn btn-primary" href="#contact">Request a service</a>
            <a class="btn btn-secondary" href="/electrician.html">Meet the electrician</a>
          </div>
        </div>
        <div class="hero-card reveal">
          <div class="mini-card"><span class="label">Available</span><strong>Residential & commercial projects</strong></div>
          <div class="mini-card"><span class="label">Custom solutions</span><strong>Bespoke tailoring & digital services</strong></div>
        </div>
      </div>
    </section>

    <section class="section intro-professionals">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Who we serve</p>
          <h2>Two specialists. One trusted platform.</h2>
        </div>
        <div class="dual-grid">
          <article class="info-card reveal">
            <div class="card-icon">E</div>
            <h3>Electrical services</h3>
            <p>Safe, efficient installations, repairs and maintenance for homes, rentals and businesses.</p>
            <a href="/electrician.html">View electrician profile</a>
          </article>
          <article class="info-card reveal">
            <div class="card-icon">T</div>
            <h3>Tailoring & fashion</h3>
            <p>Bespoke garments, alterations and finishing that balance style, comfort and a precise fit.</p>
            <a href="/tailoring.html">View tailoring profile</a>
          </article>
        </div>
      </div>
    </section>

    <section class="section services-overview">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Core services</p>
          <h2>Crafted for real household and business needs</h2>
        </div>
        <div class="service-stack">
          <article class="service-panel reveal">
            <div>
              <span class="panel-tag">Electrical</span>
              <h3>Electrical Services</h3>
              <ul>
                <li>Residential wiring and rewiring</li>
                <li>Fault diagnosis and repairs</li>
                <li>Lighting and socket installations</li>
                <li>Electrical maintenance</li>
              </ul>
            </div>
            <a href="/electrician.html" class="text-link">Explore electrician services</a>
          </article>
          <article class="service-panel reveal">
            <div>
              <span class="panel-tag alt">Tailoring</span>
              <h3>Tailoring & Fashion</h3>
              <ul>
                <li>Custom garments</li>
                <li>Alterations and fittings</li>
                <li>Repair and hemming</li>
                <li>Bespoke dressmaking</li>
              </ul>
            </div>
            <a href="/tailoring.html" class="text-link">Explore tailoring services</a>
          </article>
        </div>
      </div>
    </section>

    <section class="section portfolio-highlight">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Selected work</p>
          <h2>Projects and garment highlights</h2>
        </div>
        <div class="project-grid">${projectCards}</div>
      </div>
    </section>

    <section class="section stats-section">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Service statistics</p>
          <h2>Public performance dashboard</h2>
        </div>
        <div id="usage-stats" class="stats-grid reveal" aria-live="polite">
          <div class="stat-card"><span>Total registered users</span><strong>Loading…</strong></div>
          <div class="stat-card"><span>Total inquiries</span><strong>Loading…</strong></div>
          <div class="stat-card"><span>Inquiries today</span><strong>Loading…</strong></div>
          <div class="stat-card"><span>Inquiries this week</span><strong>Loading…</strong></div>
        </div>
      </div>
    </section>

    <section class="section credentials">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Credentials</p>
          <h2>Professional focus and practical experience</h2>
        </div>
        <div class="credentials-grid">
          <div class="credential-card reveal"><strong>7+ years</strong><span>Electrical experience</span></div>
          <div class="credential-card reveal"><strong>6+ years</strong><span>Tailoring & fitting expertise</span></div>
          <div class="credential-card reveal"><strong>Verified details</strong><span>Profiles updated by owner</span></div>
        </div>
      </div>
    </section>

    <section class="section why-us">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Why work with us</p>
          <h2>Professional standards, clear communication and long-term value</h2>
        </div>
        <div class="feature-grid">
          <article class="feature-card reveal"><h3>Craftsmanship</h3><p>Careful work, clean finishing and attention to detail in every project.</p></article>
          <article class="feature-card reveal"><h3>Communication</h3><p>Clear updates, honest guidance and practical next steps for each job.</p></article>
          <article class="feature-card reveal"><h3>Reliability</h3><p>Dependable scheduling and professional service for homes and businesses.</p></article>
          <article class="feature-card reveal"><h3>Quality</h3><p>Focused on safe, durable and well-finished outcomes that last.</p></article>
        </div>
      </div>
    </section>

    <section class="section process">
      <div class="container">
        <div class="section-heading reveal"><p class="eyebrow">How it works</p><h2>Request a service in a few simple steps</h2></div>
        <div class="steps-grid">
          <div class="step reveal"><span>01</span><h3>Share your need</h3><p>Tell us what you need and where the work is taking place.</p></div>
          <div class="step reveal"><span>02</span><h3>Review the fit</h3><p>We discuss scope, timing and the best approach for your project.</p></div>
          <div class="step reveal"><span>03</span><h3>Confirm and proceed</h3><p>Once approved, the work begins with clear communication and a dependable outcome.</p></div>
        </div>
      </div>
    </section>

    <section id="contact" class="section contact-section">
      <div class="container contact-grid">
        <div class="contact-card reveal">
          <p class="eyebrow">Contact</p>
          <h2>Request a quote or discuss your project.</h2>
          <ul class="contact-list">
            <li><a href="tel:0721909801">Phone: 0721909801</a></li>
            <li><a href="sms:0721909801">SMS</a></li>
            <li><a href="https://wa.me/254721909801" target="_blank" rel="noreferrer">WhatsApp</a></li>
            <li><a href="mailto:hello@craftandcurrent.co.ke">Email</a></li>
          </ul>
        </div>

        <form class="enquiry-form reveal" method="POST" action="/enquiry">
          <div class="field-grid">
            <label><span>Your name</span><input type="text" name="customer_name" placeholder="Your name" required /></label>
            <label><span>Professional</span><select name="role" required><option value="electrician">Electrician</option><option value="tailor">Tailor</option><option value="developer">Developer</option></select></label>
          </div>
          <label><span>How should they contact you?</span><select name="contact_method" required><option value="WhatsApp">WhatsApp</option><option value="Email">Email</option></select></label>
          <label><span>Your WhatsApp number or email address</span><input type="text" name="customer_contact" maxlength="254" placeholder="Enter your WhatsApp number or email" required /></label>
          <label><span>Service location</span><input type="text" name="service_location" maxlength="180" placeholder="Address, landmark, town, or nearby area" /></label>
          <input type="hidden" name="location_source" value="manual" />
          <div class="field-grid">
            <button type="button" class="btn btn-secondary use-location-btn" aria-label="Use current browser location for the service request" title="This uses browser geolocation only to help describe the service area. We do not publish exact coordinates.">Use current location</button>
          </div>
          <small class="field-help">We use location only to plan the service and never publish precise home coordinates or private addresses.</small>
          <label><span>Subject</span><input type="text" name="subject" placeholder="Electrical repair or tailoring request" required /></label>
          <label><span>Project details</span><textarea name="message" rows="5" placeholder="Please share your project details..." required></textarea></label>
          <div class="field-grid">
            <label><span>Preferred date</span><input type="date" name="date" /></label>
          </div>
          <button type="submit" class="btn btn-primary">Send enquiry</button>
        </form>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <div class="brand footer-brand"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></div>
        <p>Trusted services in electrical work, tailoring and digital solutions for homes, businesses and growing brands.</p>
      </div>
      <div>
        <h4>Services</h4>
        <ul>
          <li><a href="/electrician.html">Electrical services</a></li>
          <li><a href="/tailoring.html">Tailoring & fashion</a></li>
          <li><a href="/developer.html">Developer services</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="tel:0721909801">0721909801</a></li>
          <li><a href="mailto:hello@craftandcurrent.co.ke">hello@craftandcurrent.co.ke</a></li>
          <li><a href="/developer.html">Designed and developed by Developer Name</a></li>
        </ul>
      </div>
    </div>
    <div class="container footer-bottom"><p>© 2026 Craft & Current. All rights reserved.</p></div>
  </footer>
  <script src="/js/main.js"></script>
</body>
</html>`;
}

async function renderProfilePage(role, enquirySent = false) {
  const data = await loadData();
  const profile = data.profiles[role] || data.profiles.electrician;
  const services = data.services[role] || [];
  const projects = data.projects[role] || [];
  const serviceHtml = services.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description)}</p></li>`).join('');
  const projectHtml = projects.map((item) => {
    const comments = (item.comments || []).map((comment) => `<li><strong>${escapeHtml(comment.name)}</strong><p>${escapeHtml(comment.text)}</p></li>`).join('');
    return `<article class="project-card reveal"><img class="project-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" /><div class="project-copy"><span class="panel-tag">${escapeHtml(item.category || 'Project')}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><section class="project-comments" aria-label="Comments on ${escapeHtml(item.title)}"><h4>Appreciate this work</h4>${comments ? `<ul class="comment-list">${comments}</ul>` : '<p class="empty-comments">No comments yet. Be the first to appreciate this work.</p>'}<form method="POST" action="/comment" class="comment-form"><input type="hidden" name="role" value="${escapeHtml(role)}" /><input type="hidden" name="project_id" value="${escapeHtml(item.id)}" /><label><span>Your name</span><input type="text" name="name" maxlength="80" required /></label><label><span>Your comment</span><textarea name="text" rows="3" maxlength="1000" required></textarea></label><button type="submit" class="btn btn-secondary">Post comment</button></form></section></div></article>`;
  }).join('');

  const enquiryForm = `<form class="enquiry-form reveal" method="POST" action="/enquiry"><input type="hidden" name="role" value="${escapeHtml(role)}" /><label><span>Your name</span><input type="text" name="customer_name" maxlength="100" required /></label><label><span>How should ${role === 'tailor' ? 'the tailor' : role === 'electrician' ? 'the electrician' : 'the developer'} contact you?</span><select name="contact_method" required><option value="WhatsApp">WhatsApp</option><option value="Email">Email</option></select></label><label><span>Your WhatsApp number or email address</span><input type="text" name="customer_contact" maxlength="254" autocomplete="email" placeholder="Enter your WhatsApp number or email" required /></label><label><span>${role === 'tailor' ? 'Garment or service required' : role === 'electrician' ? 'Project or service' : 'Project required'}</span><input type="text" name="subject" maxlength="160" required /></label><label><span>Project details</span><textarea name="message" rows="5" maxlength="3000" required></textarea></label>${role === 'tailor' ? '<div class="field-grid"><label><span>Preferred date</span><input type="date" name="date" /></label></div>' : ''}<button class="btn btn-primary" type="submit">Send enquiry</button></form>`;
  const messageForm = `<form class="enquiry-form reveal" method="POST" action="/conversation"><input type="hidden" name="role" value="${escapeHtml(role)}" /><label><span>Your name</span><input type="text" name="customer_name" maxlength="80" required /></label><label><span>Preferred contact</span><input type="text" name="customer_contact" maxlength="254" placeholder="WhatsApp number or email" required /></label><label><span>Private message</span><textarea name="message" rows="4" maxlength="2000" required></textarea></label><button class="btn btn-secondary" type="submit">Open private conversation</button></form>`;
  const contactForm = enquiryForm;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>${escapeHtml(role === 'electrician' ? 'Electrician Profile | Craft & Current' : role === 'tailor' ? 'Tailoring & Fashion Profile | Craft & Current' : 'Developer Portfolio | Craft & Current')}</title>
  <meta name="description" content="${escapeHtml(profile.bio)}" />
  <link rel="stylesheet" href="/styles/tokens.css" />
  <link rel="stylesheet" href="/styles/reset.css" />
  <link rel="stylesheet" href="/styles/global.css" />
  <link rel="stylesheet" href="/styles/layout.css" />
  <link rel="stylesheet" href="/styles/components.css" />
  <link rel="stylesheet" href="/styles/home.css" />
  <link rel="stylesheet" href="/styles/electrician.css" />
  <link rel="stylesheet" href="/styles/tailoring.css" />
  <link rel="stylesheet" href="/styles/developer.css" />
  <link rel="stylesheet" href="/styles/dashboard.css" />
  <link rel="stylesheet" href="/styles/animations.css" />
  <link rel="stylesheet" href="/styles/responsive.css" />
</head>
<body>
  <header class="site-header">
    <div class="container nav-shell">
      <a class="brand" href="/" aria-label="Home"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></a>
      <nav class="main-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/electrician.html">Electrician</a><a href="/tailoring.html">Tailoring</a><a href="/developer.html">Developer</a></nav>
      <div class="nav-actions"><a class="btn btn-secondary" href="/login.html">Owner Login</a><a class="btn btn-primary" href="/#contact">Make an enquiry</a></div>
    </div>
  </header>
  <main class="profile-page ${role === 'electrician' ? 'electrician-page' : role === 'tailor' ? 'tailoring-page' : 'developer-page'}">
    <section class="profile-hero">
      <div class="container profile-hero-inner">
        <div class="profile-media reveal"><img src="${escapeHtml(profile.photo)}" alt="${escapeHtml(profile.name)}" /></div>
        <div class="profile-copy reveal">
          <p class="eyebrow">${role === 'electrician' ? 'Electrical services' : role === 'tailor' ? 'Tailoring & fashion' : 'Developer services'}</p>
          <h1>${escapeHtml(profile.name)}</h1>
          <h2>${escapeHtml(profile.title)}</h2>
          <p class="lead">${escapeHtml(profile.bio)}</p>
          <ul class="meta-list">
            <li><strong>Location:</strong> ${escapeHtml(profile.location)}</li>
            <li><strong>Availability:</strong> ${escapeHtml(profile.availability)}</li>
            <li><strong>Experience:</strong> ${escapeHtml(profile.experience_years)}</li>
            <li><strong>Preferred work:</strong> ${escapeHtml(profile.employment_type)}</li>
          </ul>
          <div class="cta-row">
            ${profile.phone ? `<a class="btn btn-primary" href="tel:${escapeHtml(phoneHref(profile.phone))}">Call ${escapeHtml(roleNames[role])}</a>` : ''}
            ${profile.whatsapp ? `<a class="btn btn-secondary" href="https://wa.me/${escapeHtml(whatsappNumber(profile.whatsapp))}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
            ${profile.email ? `<a class="btn btn-secondary" href="mailto:${escapeHtml(profile.email)}">Email</a>` : ''}
          </div>
        </div>
      </div>
    </section>

    <section class="section profile-section">
      <div class="container two-column-layout">
        <div class="content-block reveal">
          <p class="eyebrow">Services</p>
          <h3>${role === 'electrician' ? 'Electrical services offered' : role === 'tailor' ? 'Tailoring services' : 'Technology and services'}</h3>
          <ul class="content-list">${serviceHtml}</ul>
        </div>
        <div class="content-block reveal">
          <p class="eyebrow">Overview</p>
          <h3>${role === 'electrician' ? 'Professional summary' : role === 'tailor' ? 'Business profile' : 'Case study'}</h3>
          <p>${escapeHtml(profile.overview)}</p>
        </div>
      </div>
    </section>

    <section class="section profile-section alt-panel" id="work">
      <div class="container">
        <div class="section-heading reveal">
          <p class="eyebrow">Project portfolio</p>
          <h2>${role === 'electrician' ? 'Completed work and installation highlights' : role === 'tailor' ? 'Garment highlights and recent work' : 'Selected examples and case studies'}</h2>
        </div>
        <div class="project-grid">${projectHtml}</div>
      </div>
    </section>

    <section id="contact" class="section contact-section">
      <div class="container contact-grid">
        <div class="contact-card reveal">
          <p class="eyebrow">Contact</p>
          <h2>${role === 'electrician' ? 'Book a consultation or request electrical support' : role === 'tailor' ? 'Request a quote for garments, repairs or alterations' : 'Request a project quote'}</h2>
          ${enquirySent ? '<p class="form-message">Thank you. Your enquiry has been sent to the professional.</p>' : ''}
          <ul class="contact-list">
            ${profile.phone ? `<li><a href="tel:${escapeHtml(phoneHref(profile.phone))}">Call ${escapeHtml(roleNames[role])}</a></li>` : ''}
            ${profile.whatsapp ? `<li><a href="https://wa.me/${escapeHtml(whatsappNumber(profile.whatsapp))}" target="_blank" rel="noreferrer">WhatsApp</a></li>` : ''}
            ${profile.email ? `<li><a href="mailto:${escapeHtml(profile.email)}">Email</a></li>` : ''}
          </ul>
        </div>
        ${contactForm}
        ${messageForm}
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-grid">
      <div><div class="brand footer-brand"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></div><p>Trusted services in electrical work, tailoring and digital solutions for homes, businesses and growing brands.</p></div>
      <div><h4>Services</h4><ul><li><a href="/electrician.html">Electrical services</a></li><li><a href="/tailoring.html">Tailoring & fashion</a></li><li><a href="/developer.html">Developer services</a></li></ul></div>
      <div><h4>Contact</h4><ul><li><a href="tel:0721909801">0721909801</a></li><li><a href="mailto:hello@craftandcurrent.co.ke">hello@craftandcurrent.co.ke</a></li><li><a href="/developer.html">Designed and developed by Developer Name</a></li></ul></div>
    </div>
    <div class="container footer-bottom"><p>© 2026 Craft & Current. All rights reserved.</p></div>
  </footer>
  <script src="/js/main.js"></script>
</body>
</html>`;
}

function renderLoginPage(errorMessage = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>Staff Login</title>
  <link rel="stylesheet" href="/styles/tokens.css" />
  <link rel="stylesheet" href="/styles/reset.css" />
  <link rel="stylesheet" href="/styles/global.css" />
  <link rel="stylesheet" href="/styles/layout.css" />
  <link rel="stylesheet" href="/styles/components.css" />
  <link rel="stylesheet" href="/styles/home.css" />
  <link rel="stylesheet" href="/styles/dashboard.css" />
  <link rel="stylesheet" href="/styles/animations.css" />
  <link rel="stylesheet" href="/styles/responsive.css" />
</head>
<body>
  <header class="site-header">
    <div class="container nav-shell">
      <a class="brand" href="/" aria-label="Home"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></a>
      <nav class="main-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/electrician.html">Electrician</a><a href="/tailoring.html">Tailoring</a><a href="/developer.html">Developer</a></nav>
      <div class="nav-actions"><a class="btn btn-secondary" href="/login.html">Owner Login</a></div>
    </div>
  </header>
  <main class="auth-page">
    <div class="container auth-shell">
      <form class="auth-form reveal" method="POST" action="/login">
        <p class="eyebrow">Secure access</p>
        <h1>Professional dashboard login</h1>
        ${errorMessage ? `<div class="form-message error">${escapeHtml(errorMessage)}</div>` : ''}
        <label><span>Role</span><select name="role"><option value="electrician">Electrician</option><option value="tailor">Tailor</option><option value="developer">Developer</option></select></label>
        <label><span>Password</span><input type="password" name="password" required /></label>
        <button class="btn btn-primary" type="submit">Log in</button>
      </form>
    </div>
  </main>
  <footer class="site-footer">
    <div class="container footer-grid"><div><div class="brand footer-brand"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></div><p>Trusted services in electrical work, tailoring and digital solutions.</p></div><div><h4>Services</h4><ul><li><a href="/electrician.html">Electrical services</a></li><li><a href="/tailoring.html">Tailoring & fashion</a></li><li><a href="/developer.html">Developer services</a></li></ul></div><div><h4>Contact</h4><ul><li><a href="tel:0721909801">0721909801</a></li><li><a href="mailto:hello@craftandcurrent.co.ke">hello@craftandcurrent.co.ke</a></li></ul></div></div>
    <div class="container footer-bottom"><p>© 2026 Craft & Current. All rights reserved.</p></div>
  </footer>
  <script src="/js/main.js"></script>
</body>
</html>`;
}

async function renderDashboardPage(role) {
  const data = await loadData();
  const profile = data.profiles[role] || data.profiles.electrician;
  const services = data.services[role] || [];
  const projects = data.projects[role] || [];
  const enquiries = data.enquiries.filter((item) => item.role === role).slice().reverse();
  const pendingEnquiries = enquiries.filter((item) => (item.status || 'Received') === 'Received');
  const statusOptions = ['Received', 'Under Review', 'Provider Responded', 'In Discussion', 'Agreed', 'Completed', 'Declined', 'Cancelled', 'Closed'];
  const enquiryList = enquiries.length
    ? enquiries.map((item) => {
      const contactLink = item.contact_method === 'WhatsApp'
        ? `https://wa.me/${whatsappNumber(item.customer_contact)}`
        : `mailto:${encodeURIComponent(item.customer_contact || '')}`;
      const statusHistory = Array.isArray(item.status_history) && item.status_history.length
        ? item.status_history.map((step) => `<li>${escapeHtml(step.status)} · ${escapeHtml(new Date(step.created_at).toLocaleString())}</li>`).join('')
        : `<li>${escapeHtml(item.status || 'Received')} · ${escapeHtml(new Date(item.created_at || Date.now()).toLocaleString())}</li>`;
      const responses = Array.isArray(item.responses) && item.responses.length
        ? item.responses.map((response) => `<li><strong>${escapeHtml(roleNames[response.provider_role] || response.provider_role)}</strong> — ${escapeHtml(response.message)} <small>${escapeHtml(new Date(response.created_at).toLocaleString())}</small></li>`).join('')
        : '<li>No provider response yet.</li>';
      return `<article class="enquiry-item" id="inquiry-${escapeHtml(item.id || '')}"><div class="enquiry-heading"><h4>${escapeHtml(item.subject || 'Service enquiry')}</h4><time>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : '')}</time></div><p><strong>${escapeHtml(item.customer_name)}</strong> — ${escapeHtml(item.message)}</p><p>Preferred contact: <a href="${contactLink}" ${item.contact_method === 'WhatsApp' ? 'target="_blank" rel="noreferrer"' : ''}>${escapeHtml(item.contact_method)}: ${escapeHtml(item.customer_contact)}</a></p>${item.service_location ? `<p>Service location: ${escapeHtml(item.service_location)}</p>` : ''}${item.date ? `<p>Preferred date: ${escapeHtml(item.date)}</p>` : ''}<div class="status-strip"><label><span>Status</span><form method="POST" action="/dashboard/${escapeHtml(role)}/update-status"><input type="hidden" name="inquiry_id" value="${escapeHtml(item.id || '')}" /><select name="status">${statusOptions.map((option) => `<option value="${escapeHtml(option)}" ${option === (item.status || 'Received') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select><button class="btn btn-secondary" type="submit">Update</button></form></label></div><div class="activity-box"><h5>Responses</h5><ul>${responses}</ul></div><form method="POST" action="/dashboard/${escapeHtml(role)}/respond-enquiry" class="response-form"><input type="hidden" name="inquiry_id" value="${escapeHtml(item.id || '')}" /><label><span>Provider response</span><textarea name="response" rows="2" maxlength="2000" required></textarea></label><button class="btn btn-primary" type="submit">Send response</button></form><div class="activity-box"><h5>Status history</h5><ul>${statusHistory}</ul></div></article>`;
    }).join('')
    : '<p class="empty-comments">No enquiries received yet.</p>';

  const conversations = (data.conversations || []).filter((item) => item.role === role).slice().reverse();
  const conversationList = conversations.length
    ? conversations.map((conversation) => {
        const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        const lastMessage = messages[messages.length - 1];
        const unreadCount = countUnreadMessages(conversation, role);
        return `<article class="enquiry-item" id="conversation-${escapeHtml(conversation.id || '')}"><div class="enquiry-heading"><h4>${escapeHtml(conversation.customer_name || 'Customer conversation')}</h4><time>${escapeHtml(conversation.updated_at ? new Date(conversation.updated_at).toLocaleString() : '')}</time></div><p>${unreadCount ? `<strong>${unreadCount} unread</strong> · ` : ''}${escapeHtml(lastMessage ? lastMessage.body : 'No messages yet')}</p>${unreadCount ? `<form method="POST" action="/dashboard/${escapeHtml(role)}/mark-read" class="notification-action-form"><input type="hidden" name="conversation_id" value="${escapeHtml(conversation.id || '')}" /><button class="btn btn-secondary" type="submit">Mark messages as read</button></form>` : ''}<form method="POST" action="/dashboard/${escapeHtml(role)}/respond-message" class="response-form"><input type="hidden" name="conversation_id" value="${escapeHtml(conversation.id || '')}" /><label><span>Reply</span><textarea name="message" rows="2" maxlength="2000" required></textarea></label><button class="btn btn-secondary" type="submit">Reply privately</button></form></article>`;
      }).join('')
    : '<p class="empty-comments">No private conversations yet.</p>';
  const unreadMessageCount = conversations.reduce((total, conversation) => total + countUnreadMessages(conversation, role), 0);
  const notificationCount = pendingEnquiries.length + unreadMessageCount;
  const notificationItems = [
    ...pendingEnquiries.map((item) => ({
      href: `#inquiry-${encodeURIComponent(item.id || '')}`,
      label: `New inquiry: ${item.subject || 'Service inquiry'}`,
      time: item.created_at || ''
    })),
    ...conversations
      .filter((conversation) => countUnreadMessages(conversation, role) > 0)
      .map((conversation) => ({
        href: `#conversation-${encodeURIComponent(conversation.id || '')}`,
        label: `New private message from ${conversation.customer_name || 'a customer'}`,
        time: conversation.updated_at || conversation.created_at || ''
      }))
  ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 10);
  const notificationList = notificationItems.length
    ? notificationItems.map((item) => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a><time>${escapeHtml(item.time ? new Date(item.time).toLocaleString() : '')}</time></li>`).join('')
    : '<li class="empty-comments">No new inquiry or message notifications.</li>';
  const securityEvents = (data.security_events || []).slice(-20).reverse();
  const securityEventList = securityEvents.length
    ? securityEvents.map((event) => `<li><strong>${escapeHtml(String(event.event || 'security event').replace(/_/g, ' '))}</strong> · ${escapeHtml(event.role || 'unknown')} · source ${escapeHtml(event.source_hash || 'unavailable')} · ${escapeHtml(new Date(event.created_at).toLocaleString())}</li>`).join('')
    : '<li class="empty-comments">No security events logged.</li>';

  const serviceList = services.map((item) => `
    <li>
      <span>${escapeHtml(item.title)}</span>
      <form method="POST" action="/dashboard/${escapeHtml(role)}/delete-service">
        <input type="hidden" name="title" value="${escapeHtml(item.title)}" />
        <button class="btn btn-secondary" type="submit">Delete</button>
      </form>
    </li>`).join('');

  const projectList = projects.map((item) => `
    <li>
      <span>${escapeHtml(item.title)}</span>
      <form method="POST" action="/dashboard/${escapeHtml(role)}/delete-project">
        <input type="hidden" name="title" value="${escapeHtml(item.title)}" />
        <button class="btn btn-secondary" type="submit">Delete</button>
      </form>
    </li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>${escapeHtml(roleNames[role] || 'Dashboard')}</title>
  <link rel="stylesheet" href="/styles/tokens.css" />
  <link rel="stylesheet" href="/styles/reset.css" />
  <link rel="stylesheet" href="/styles/global.css" />
  <link rel="stylesheet" href="/styles/layout.css" />
  <link rel="stylesheet" href="/styles/components.css" />
  <link rel="stylesheet" href="/styles/dashboard.css" />
  <link rel="stylesheet" href="/styles/animations.css" />
  <link rel="stylesheet" href="/styles/responsive.css" />
</head>
<body>
  <header class="site-header">
    <div class="container nav-shell">
      <a class="brand" href="/" aria-label="Home"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></a>
      <nav class="main-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/electrician.html">Electrician</a><a href="/tailoring.html">Tailoring</a><a href="/developer.html">Developer</a></nav>
      <div class="nav-actions"><a class="btn btn-secondary" href="/logout">Log out</a></div>
    </div>
  </header>
  <main class="dashboard-page">
    <div class="container dashboard-shell">
      <aside class="dashboard-sidebar reveal">
        <h2>${escapeHtml(roleNames[role])}</h2>
        <nav><a href="/dashboard.html?role=${escapeHtml(role)}">Profile</a><a href="/logout">Log out</a></nav>
      </aside>
      <section class="dashboard-main reveal">
        <div class="dashboard-header">
          <div><p class="eyebrow">Dashboard</p><h1>${escapeHtml(profile.name || 'Update profile')}</h1></div>
          <div class="dashboard-actions">
            <a class="btn btn-primary notification-button" href="#notifications" aria-label="Notifications, ${notificationCount} pending updates">
              Notifications <span class="notification-badge" id="notification-count" aria-live="polite">${notificationCount}</span>
            </a>
            <a class="btn btn-secondary" href="/" target="_blank" rel="noreferrer">Preview site</a>
          </div>
        </div>

        <div class="dashboard-metrics">
          <div class="metric-card"><span>Total inquiries</span><strong>${escapeHtml(String(enquiries.length))}</strong></div>
          <div class="metric-card"><span>Today</span><strong>${escapeHtml(String(enquiries.filter((item) => item.created_at && new Date(item.created_at).toDateString() === new Date().toDateString()).length))}</strong></div>
          <div class="metric-card"><span>This week</span><strong>${escapeHtml(String(enquiries.filter((item) => item.created_at && Date.now() - new Date(item.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000).length))}</strong></div>
        </div>

        <section class="dashboard-section notification-section" id="notifications" aria-labelledby="notifications-heading">
          <h3 id="notifications-heading">Notifications</h3>
          <p>New inquiries awaiting review and incoming private messages for your service.</p>
          <ul class="notification-list">${notificationList}</ul>
        </section>

        <section class="dashboard-section security-events-section" id="security-events" aria-labelledby="security-events-heading">
          <h3 id="security-events-heading">Security activity</h3>
          <p>Recent authentication and access-denial events. Source identifiers are one-way hashes; passwords and message contents are never logged.</p>
          <ul class="security-event-list">${securityEventList}</ul>
        </section>

        <form method="POST" action="/dashboard/${escapeHtml(role)}/save" class="dashboard-form">
          <input type="hidden" name="section" value="profile" />
          <div class="field-grid">
            <label><span>Full name</span><input type="text" name="name" value="${escapeHtml(profile.name || '')}" /></label>
            <label><span>Professional title</span><input type="text" name="title" value="${escapeHtml(profile.title || '')}" /></label>
          </div>
          <label><span>Bio</span><textarea name="bio" rows="4">${escapeHtml(profile.bio || '')}</textarea></label>
          <div class="field-grid">
            <label><span>Location</span><input type="text" name="location" value="${escapeHtml(profile.location || '')}" /></label>
            <label><span>Availability</span><input type="text" name="availability" value="${escapeHtml(profile.availability || '')}" /></label>
          </div>
          <div class="field-grid">
            <label><span>Experience</span><input type="text" name="experience_years" value="${escapeHtml(profile.experience_years || '')}" /></label>
            <label><span>Employment type</span><input type="text" name="employment_type" value="${escapeHtml(profile.employment_type || '')}" /></label>
          </div>
          <div class="field-grid">
            <label><span>Phone</span><input type="text" name="phone" value="${escapeHtml(profile.phone || '')}" /></label>
            <label><span>WhatsApp</span><input type="text" name="whatsapp" value="${escapeHtml(profile.whatsapp || '')}" /></label>
          </div>
          <div class="field-grid">
            <label><span>Email</span><input type="email" name="email" value="${escapeHtml(profile.email || '')}" /></label>
            <label><span>Social link</span><input type="text" name="social" value="${escapeHtml(profile.social || '')}" /></label>
          </div>
          <label><span>Overview</span><textarea name="overview" rows="3">${escapeHtml(profile.overview || '')}</textarea></label>
          <button class="btn btn-primary" type="submit">Save profile</button>
        </form>

        <div class="dashboard-section">
          <h3>Profile picture</h3>
          <div class="profile-upload-row">
            <img class="dashboard-profile-photo" src="${escapeHtml(profile.photo)}" alt="${escapeHtml(profile.name)}" />
            <form method="POST" action="/dashboard/${escapeHtml(role)}/upload-profile" enctype="multipart/form-data" class="upload-form">
              <label><span>Choose a JPEG, PNG, or WebP image (max ${maxImageLabel})</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label>
              <button class="btn btn-primary" type="submit">Upload profile picture</button>
            </form>
          </div>
        </div>

        <div class="dashboard-section">
          <h3>Add service</h3>
          <form method="POST" action="/dashboard/${escapeHtml(role)}/save" class="inline-form">
            <input type="hidden" name="section" value="service" />
            <input type="text" name="title" placeholder="Service title" required />
            <textarea name="description" rows="2" placeholder="Description" required></textarea>
            <button class="btn btn-primary" type="submit">Add service</button>
          </form>
          <ul class="management-list">${serviceList}</ul>
        </div>

        <div class="dashboard-section">
          <h3>Share work in progress</h3>
          <form method="POST" action="/dashboard/${escapeHtml(role)}/upload-project" enctype="multipart/form-data" class="upload-form">
            <label><span>Photo (JPEG, PNG, or WebP; max ${maxImageLabel})</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label>
            <div class="field-grid">
              <label><span>Project or product title</span><input type="text" name="title" maxlength="120" required /></label>
              <label><span>Category</span><input type="text" name="category" maxlength="80" placeholder="Optional" /></label>
            </div>
            <label><span>Describe the work</span><textarea name="description" rows="3" maxlength="1000" required></textarea></label>
            <button class="btn btn-primary" type="submit">Upload work photo</button>
          </form>
          <ul class="management-list">${projectList}</ul>
        </div>

        <div class="dashboard-section enquiries-section">
          <h3>Private conversations (${conversations.length})</h3>
          <p>Customers can start a separate private conversation with your team.</p>
          <div class="enquiry-list">${conversationList}</div>
        </div>

        <div class="dashboard-section enquiries-section">
          <h3>Enquiries (${enquiries.length})</h3>
          <p>Only you can see enquiries sent to your profile.</p>
          <div class="enquiry-list">${enquiryList}</div>
        </div>
      </section>
    </div>
  </main>
  <footer class="site-footer">
    <div class="container footer-grid"><div><div class="brand footer-brand"><span class="brand-mark">C&C</span><div><strong>Craft & Current</strong><small>Professional Services</small></div></div><p>Professional service dashboard and portfolio management.</p></div><div><h4>Services</h4><ul><li><a href="/electrician.html">Electrical services</a></li><li><a href="/tailoring.html">Tailoring & fashion</a></li><li><a href="/developer.html">Developer services</a></li></ul></div><div><h4>Contact</h4><ul><li><a href="tel:0721909801">0721909801</a></li><li><a href="mailto:hello@craftandcurrent.co.ke">hello@craftandcurrent.co.ke</a></li></ul></div></div>
    <div class="container footer-bottom"><p>© 2026 Craft & Current. All rights reserved.</p></div>
  </footer>
  <script>window.dashboardRole = ${JSON.stringify(role)};</script>
  <script src="/js/main.js"></script>
</body>
</html>`;
}

async function handleRequest(req, res) {
  validateRequiredEnvironment();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    if (pool) {
      try {
        await initializeDatabase();
        await pool.query('SELECT 1');
      } catch (error) {
        console.error('Health check database failure:', error.code || error.name || 'unknown error');
        return sendJson(res, { status: 'unavailable' }, 503);
      }
    }
    return sendJson(res, { status: 'ok' });
  }

  if (isProduction && !isSecureRequest(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return sendHtml(res, '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>HTTPS required</title></head><body><h1>Secure connection required</h1><p>Configure a trusted HTTPS reverse proxy and set TRUST_PROXY=true before making this site public.</p></body></html>', 426);
  }

  if (req.method === 'POST' && pathname === '/login') {
    const body = parseFormData(await readBody(req));
    const role = body.role;
    const password = body.password || '';
    if (!await recordLoginAttempt(req)) {
      await recordSecurityEvent(req, 'login_rate_limited', role);
      return sendHtml(res, renderLoginPage('Too many login attempts. Please wait 15 minutes before trying again.'), 429);
    }
    if (!roleNames[role] || !password || password !== (passwords[role] || '')) {
      await recordSecurityEvent(req, 'login_failed', role);
      return sendHtml(res, renderLoginPage('Incorrect password or role. Please try again.'), 401);
    }
    await clearLoginAttempts(req);
    await setSession(res, role, isProduction || isSecureRequest(req));
    await recordSecurityEvent(req, 'login_succeeded', role);
    return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
  }

  if (req.method === 'GET' && pathname === '/logout') {
    const session = await getSession(req);
    if (session) {
      if (pool) {
        await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [
          crypto.createHash('sha256').update(session.id).digest('hex')
        ]);
      } else {
        sessions.delete(session.id);
      }
    }
    res.setHeader('Set-Cookie', 'sessionId=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return redirect(res, '/');
  }

  if (req.method === 'POST' && pathname === '/enquiry') {
    const body = parseFormData(await readBody(req));
    const contactIsValid = body.contact_method === 'WhatsApp'
      ? /^[+()\d\s-]{7,24}$/.test(body.customer_contact || '') && /\d/.test(body.customer_contact || '')
      : body.contact_method === 'Email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customer_contact || '');
    const serviceLocation = normalizeMessageText(body.service_location || '', 180);
    if (!roleNames[body.role] || !['WhatsApp', 'Email'].includes(body.contact_method) ||
        !body.customer_name || !body.customer_contact || !body.subject || !body.message ||
        body.customer_name.length > 100 || body.customer_contact.length > 254 ||
        body.subject.length > 160 || body.message.length > 3000 || serviceLocation.length > 180 || !contactIsValid) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Please provide your name, enquiry details, and a WhatsApp number or email address.</h1><p><a href="/">Return to the website</a></p></body></html>', 400);
    }
    const enquiryId = crypto.randomBytes(12).toString('hex');
    const contactValue = String(body.customer_contact).slice(0, 254);
    await updateData((data) => {
      data.enquiries.push({
        id: enquiryId,
        role: body.role,
        customer_name: body.customer_name.slice(0, 100),
        contact_method: body.contact_method,
        customer_contact: contactValue,
        subject: body.subject.slice(0, 160),
        message: body.message.slice(0, 3000),
        service_location: serviceLocation,
        location_source: body.location_source || 'manual',
        date: body.date || '',
        status: 'Received',
        status_history: [{ status: 'Received', created_at: new Date().toISOString() }],
        responses: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    res.setHeader('Set-Cookie', `customerContact=${encodeURIComponent(contactValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    const profilePath = body.role === 'tailor' ? 'tailoring' : body.role;
    return redirect(res, `/${profilePath}.html?enquiry=sent#contact`);
  }

  if (req.method === 'POST' && pathname === '/comment') {
    const body = parseFormData(await readBody(req));
    if (!roleNames[body.role] || !body.project_id || !body.name.trim() || !body.text.trim() ||
        body.name.length > 80 || body.text.length > 1000) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Please enter your name and a comment of up to 1,000 characters.</h1><p><a href="/">Return to the website</a></p></body></html>', 400);
    }
    let projectFound = false;
    await updateData((data) => {
      const project = (data.projects[body.role] || []).find((item) => item.id === body.project_id);
      if (!project) return;
      projectFound = true;
      project.comments.push({
        name: body.name.trim(),
        text: body.text.trim(),
        created_at: new Date().toISOString()
      });
    });
    if (!projectFound) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>That work post could not be found.</h1><p><a href="/">Return to the website</a></p></body></html>', 404);
    }
    const profilePath = body.role === 'tailor' ? 'tailoring' : body.role;
    return redirect(res, `/${profilePath}.html#work`);
  }

  if (req.method === 'GET' && pathname === '/api/stats') {
    const data = await loadData();
    return sendJson(res, buildUsageStatistics(data));
  }

  if (req.method === 'GET' && pathname === '/api/customer-status') {
    const cookie = parseCookies(req.headers.cookie);
    const customerContact = (cookie.customerContact || url.searchParams.get('contact') || '').trim();
    if (!customerContact) {
      return sendJson(res, { welcome_back: false, existing_inquiries: [] });
    }
    const data = await loadData();
    const matching = (data.enquiries || []).filter((item) => String(item.customer_contact || '').toLowerCase() === customerContact.toLowerCase());
    const summary = matching.map((item) => ({
      id: item.id,
      role: item.role,
      subject: item.subject,
      status: item.status || 'Received',
      created_at: item.created_at,
      updated_at: item.updated_at,
      last_response: Array.isArray(item.responses) && item.responses.length ? item.responses[item.responses.length - 1] : null
    }));
    return sendJson(res, {
      welcome_back: summary.length > 0,
      existing_inquiries: summary,
      latest_status: summary.length ? summary[summary.length - 1].status : null,
      unread_messages: 0
    });
  }

  if (req.method === 'GET' && pathname === '/api/conversations') {
    const session = await getSession(req);
    const role = url.searchParams.get('role');
    if (!roleNames[role] || !session || session.role !== role) {
      return sendJson(res, { error: 'Unauthorized' }, 401);
    }
    const data = await loadData();
    const filtered = (data.conversations || []).filter((conversation) => conversation.role === role).map((conversation) => buildConversationSummary(conversation, role));
    return sendJson(res, { conversations: filtered });
  }

  if (req.method === 'GET' && pathname === '/api/notifications') {
    const session = await getSession(req);
    const role = url.searchParams.get('role');
    if (!roleNames[role] || !session || session.role !== role) {
      if (roleNames[role]) await recordSecurityEvent(req, 'notification_access_denied', role);
      return sendJson(res, { error: 'Unauthorized' }, 401);
    }
    const data = await loadData();
    const pendingInquiries = (data.enquiries || []).filter((item) => item.role === role && (item.status || 'Received') === 'Received').length;
    const unreadMessages = (data.conversations || [])
      .filter((conversation) => conversation.role === role)
      .reduce((total, conversation) => total + countUnreadMessages(conversation, role), 0);
    return sendJson(res, {
      pending_inquiries: pendingInquiries,
      unread_messages: unreadMessages,
      total: pendingInquiries + unreadMessages
    });
  }

  if (req.method === 'POST' && pathname === '/conversation') {
    if (!isSameOriginRequest(req)) {
      return sendHtml(res, 'Request origin could not be verified. Please reload the page and try again.', 403);
    }
    const body = parseFormData(await readBody(req));
    if (!roleNames[body.role] || !body.customer_name || !body.customer_contact || !body.message) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Please provide your name, contact details, and message to open a private conversation.</h1><p><a href="/">Return to the website</a></p></body></html>', 400);
    }
    const messageText = normalizeMessageText(body.message, 2000);
    const inquiryId = body.inquiry_id || null;
    await updateData((data) => {
      const conversation = {
        id: crypto.randomBytes(12).toString('hex'),
        role: body.role,
        inquiry_id: inquiryId,
        customer_name: String(body.customer_name).slice(0, 80),
        customer_contact: String(body.customer_contact).slice(0, 254),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        participants: [body.role, 'customer'],
        messages: [{
          id: crypto.randomBytes(8).toString('hex'),
          sender: 'customer',
          sender_name: String(body.customer_name).slice(0, 80),
          sender_role: 'customer',
          body: messageText,
          created_at: new Date().toISOString(),
          read_by: []
        }],
        unread_by: [body.role]
      };
      data.conversations.push(conversation);
    });
    const profilePath = body.role === 'tailor' ? 'tailoring' : body.role;
    return redirect(res, `/${profilePath}.html?conversation=sent#contact`);
  }

  if (req.method === 'POST' && pathname.startsWith('/dashboard/')) {
    const parts = pathname.split('/').filter(Boolean);
    const role = parts[1];
    if (!roleNames[role]) {
      return sendHtml(res, 'Unknown role', 404);
    }

    const session = await getSession(req);
    if (!session || session.role !== role) {
      await recordSecurityEvent(req, 'dashboard_access_denied', role);
      return redirect(res, '/login.html');
    }
    if (!isSameOriginRequest(req)) {
      await recordSecurityEvent(req, 'dashboard_request_origin_rejected', role);
      return sendHtml(res, 'Request origin could not be verified. Reload the dashboard and try again.', 403);
    }

    const action = parts[2];
    if (action === 'mark-read') {
      const body = parseFormData(await readBody(req));
      let updated = false;
      await updateData((data) => {
        const conversation = (data.conversations || []).find((item) => item.id === body.conversation_id && item.role === role);
        if (!conversation) return;
        updated = true;
        conversation.messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        for (const message of conversation.messages) {
          if (message.sender === role) continue;
          message.read_by = Array.isArray(message.read_by) ? message.read_by : [];
          if (!message.read_by.includes(role)) message.read_by.push(role);
        }
        conversation.unread_by = Array.isArray(conversation.unread_by)
          ? conversation.unread_by.filter((entry) => entry !== role)
          : [];
      });
      if (!updated) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>That private conversation could not be found.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 404);
      }
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}#conversation-${encodeURIComponent(body.conversation_id)}`);
    }

    if (action === 'update-status') {
      const body = parseFormData(await readBody(req));
      const inquiryId = body.inquiry_id;
      const status = ['Received', 'Under Review', 'Provider Responded', 'In Discussion', 'Agreed', 'Completed', 'Declined', 'Cancelled', 'Closed'].includes(body.status) ? body.status : 'Received';
      let updated = false;
      await updateData((data) => {
        const enquiry = (data.enquiries || []).find((item) => item.id === inquiryId && item.role === role);
        if (!enquiry) return;
        updated = true;
        enquiry.status = status;
        enquiry.updated_at = new Date().toISOString();
        enquiry.status_history = Array.isArray(enquiry.status_history) ? enquiry.status_history : [];
        enquiry.status_history.push({ status, created_at: enquiry.updated_at, actor_role: role });
      });
      if (!updated) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>That enquiry could not be found.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 404);
      }
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
    }

    if (action === 'respond-enquiry') {
      const body = parseFormData(await readBody(req));
      const inquiryId = body.inquiry_id;
      const response = normalizeMessageText(body.response || '', 2000);
      if (!inquiryId || !response) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Write a message before sending a response.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 400);
      }
      let updated = false;
      let duplicateFound = false;
      await updateData((data) => {
        const enquiry = (data.enquiries || []).find((item) => item.id === inquiryId && item.role === role);
        if (!enquiry) return;
        const duplicate = (enquiry.responses || []).some((entry) => entry.provider_role === role && entry.message === response);
        if (duplicate) {
          duplicateFound = true;
          return;
        }
        enquiry.responses = Array.isArray(enquiry.responses) ? enquiry.responses : [];
        enquiry.responses.push({
          id: crypto.randomBytes(8).toString('hex'),
          provider_role: role,
          provider_name: roleNames[role],
          message: response,
          created_at: new Date().toISOString()
        });
        enquiry.status = 'Provider Responded';
        enquiry.updated_at = new Date().toISOString();
        enquiry.status_history = Array.isArray(enquiry.status_history) ? enquiry.status_history : [];
        enquiry.status_history.push({ status: 'Provider Responded', created_at: enquiry.updated_at, actor_role: role });
        updated = true;
      });
      if (duplicateFound) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>A duplicate provider response was detected.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 409);
      }
      if (!updated) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>That enquiry could not be found.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 404);
      }
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
    }

    if (action === 'respond-message') {
      const body = parseFormData(await readBody(req));
      const conversationId = body.conversation_id;
      const message = normalizeMessageText(body.message || '', 2000);
      if (!conversationId || !message) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Write a message before replying.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 400);
      }
      let updated = false;
      await updateData((data) => {
        const conversation = (data.conversations || []).find((item) => item.id === conversationId && item.role === role);
        if (!conversation) return;
        const newMessage = {
          id: crypto.randomBytes(8).toString('hex'),
          sender: 'provider',
          sender_name: roleNames[role],
          sender_role: role,
          body: message,
          created_at: new Date().toISOString(),
          read_by: [role]
        };
        conversation.messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        conversation.messages.push(newMessage);
        conversation.updated_at = new Date().toISOString();
        conversation.unread_by = Array.isArray(conversation.unread_by) ? conversation.unread_by.filter((entry) => entry !== role) : [];
        updated = true;
      });
      if (!updated) {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>That private conversation could not be found.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 404);
      }
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
    }

    if (action === 'upload-profile' || action === 'upload-project') {
      let upload;
      try {
        const raw = await readBody(req, maxImageBytes + 128 * 1024);
        upload = parseMultipartData(raw, req.headers['content-type']);
      } catch (error) {
        const status = error.message === 'Request too large' ? 413 : 400;
        return sendHtml(res, `<!DOCTYPE html><html lang="en"><body><h1>${escapeHtml(error.message)}</h1><p><a href="/dashboard.html?role=${encodeURIComponent(role)}">Return to your dashboard</a></p></body></html>`, status);
      }
      if (!upload.file || upload.file.fieldName !== 'image') {
        return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Choose an image file to upload.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 400);
      }
      if (action === 'upload-project') {
        const { title, category, description } = upload.fields;
        if (!title || !description || title.length > 120 || description.length > 1000 || (category && category.length > 80)) {
          return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Enter a title and description within the allowed lengths before uploading.</h1><p><a href="/dashboard.html?role=' + encodeURIComponent(role) + '">Return to your dashboard</a></p></body></html>', 400);
        }
      }
      try {
        validateUploadedImage(upload.file);
      } catch (error) {
        return sendHtml(res, `<!DOCTYPE html><html lang="en"><body><h1>${escapeHtml(error.message)}</h1><p><a href="/dashboard.html?role=${encodeURIComponent(role)}">Return to your dashboard</a></p></body></html>`, 400);
      }
      let image;
      try {
        image = await saveUploadedImage(upload.file);
      } catch (error) {
        const status = error.code === 'STORAGE_UNAVAILABLE' ? 503 : 400;
        return sendHtml(res, `<!DOCTYPE html><html lang="en"><body><h1>${escapeHtml(error.message)}</h1><p><a href="/dashboard.html?role=${encodeURIComponent(role)}">Return to your dashboard</a></p></body></html>`, status);
      }
      await updateData((data) => {
        if (action === 'upload-profile') {
          data.profiles[role].photo = image;
        } else {
        const { title, category, description } = upload.fields;
        data.projects[role].unshift({
          id: crypto.randomBytes(12).toString('hex'),
          title: title.trim(),
          category: (category || 'Work in progress').trim(),
          description: description.trim(),
          image,
          comments: [],
          created_at: new Date().toISOString()
        });
        }
      });
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
    }

    const body = parseFormData(await readBody(req));
    await updateData((data) => {
      if (body.section === 'profile') {
        data.profiles[role] = { ...(data.profiles[role] || {}), ...body };
      } else if (body.section === 'service') {
        if (body.title && body.description) {
          data.services[role] = data.services[role] || [];
          data.services[role].push({ title: body.title, description: body.description });
        }
      } else if (parts[2] === 'delete-service') {
        data.services[role] = (data.services[role] || []).filter((item) => item.title !== body.title);
      } else if (parts[2] === 'delete-project') {
        data.projects[role] = (data.projects[role] || []).filter((item) => item.title !== body.title);
      }
    });
    return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendHtml(res, await renderHomePage());
  }

  if (pathname === '/electrician.html' || pathname === '/electrician') {
    return sendHtml(res, await renderProfilePage('electrician', url.searchParams.get('enquiry') === 'sent'));
  }

  if (pathname === '/tailoring.html' || pathname === '/tailoring') {
    return sendHtml(res, await renderProfilePage('tailor', url.searchParams.get('enquiry') === 'sent'));
  }

  if (pathname === '/developer.html' || pathname === '/developer') {
    return sendHtml(res, await renderProfilePage('developer', url.searchParams.get('enquiry') === 'sent'));
  }

  if (pathname === '/login.html' || pathname === '/login') {
    const session = await getSession(req);
    if (session && session.role) {
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(session.role)}`);
    }
    return sendHtml(res, renderLoginPage());
  }

  if (pathname === '/dashboard.html') {
    const role = url.searchParams.get('role') || 'electrician';
    if (!roleNames[role]) {
      return sendHtml(res, 'Unknown role', 404);
    }
    const session = await getSession(req);
    if (!session || session.role !== role) {
      if (roleNames[role]) await recordSecurityEvent(req, 'dashboard_access_denied', role);
      return redirect(res, '/login.html');
    }
    return sendHtml(res, await renderDashboardPage(role));
  }

  if (pathname === '/robots.txt') {
    return sendHtml(res, 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n');
  }

  if (pathname === '/sitemap.xml') {
    return sendHtml(res, '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/electrician.html</loc></url><url><loc>https://example.com/tailoring.html</loc></url><url><loc>https://example.com/developer.html</loc></url><url><loc>https://example.com/login.html</loc></url></urlset>');
  }

  if (pathname.startsWith('/uploads/')) {
    if (storageProvider !== 'local') {
      return sendHtml(res, 'Not found', 404);
    }
    const filename = pathname.slice('/uploads/'.length);
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename)) {
      return sendHtml(res, 'Not found', 404);
    }
    const uploadedPath = path.join(uploadsDir, filename);
    let stat;
    try {
      stat = fs.statSync(uploadedPath);
    } catch (error) {
      if (error.code === 'ENOENT') return sendHtml(res, 'Not found', 404);
      throw error;
    }
    if (!stat.isFile()) {
      return sendHtml(res, 'Not found', 404);
    }
    const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(filename)];
    res.writeHead(200, {
      'Content-Type': mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400'
    });
    const stream = fs.createReadStream(uploadedPath);
    stream.on('error', (error) => {
      console.error('Local upload read failed:', error.code || error.name || 'unknown error');
      if (!res.headersSent) sendHtml(res, 'Unable to load image', 500);
      else res.destroy(error);
    });
    return stream.pipe(res);
  }

  const publicPath = path.resolve(publicDir, `.${pathname}`);
  if (publicPath.startsWith(`${publicDir}${path.sep}`) && fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
    const ext = path.extname(publicPath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    };
    const content = fs.readFileSync(publicPath);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    return res.end(content);
  }

  return sendHtml(res, '<!DOCTYPE html><html><body><h1>Page not found</h1></body></html>', 404);
}

async function handler(req, res) {
  try {
    return await handleRequest(req, res);
  } catch (error) {
    console.error('Request failed:', error.code || error.name || 'unknown error');
    if (res.headersSent) {
      res.destroy();
    } else if (error.code === 'ERR_INVALID_URL') {
      sendHtml(res, 'Bad request', 400);
    } else {
      sendHtml(res, '<!DOCTYPE html><html><body><h1>Server error</h1></body></html>', 500);
    }
  }
}

handler.validateConfiguration = validateRequiredEnvironment;
module.exports = handler;
