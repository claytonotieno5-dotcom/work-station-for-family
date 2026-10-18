const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const rootDir = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || path.join(rootDir, 'data', 'site-data.json'));
const replaceExisting = process.argv.includes('--replace');
const storageProvider = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
const uploadsDir = process.env.UPLOAD_DIR
  ? (path.isAbsolute(process.env.UPLOAD_DIR) ? path.normalize(process.env.UPLOAD_DIR) : path.resolve(rootDir, process.env.UPLOAD_DIR))
  : path.join(rootDir, 'uploads');

function inputError(message) {
  const error = new Error(message);
  error.code = 'MIGRATION_INPUT';
  throw error;
}

function validateImage(filename, buffer) {
  const extension = path.extname(filename).toLowerCase();
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
    inputError(`Legacy upload ${filename} must be non-empty and no larger than 8 MB.`);
  }
  const valid = extension === '.jpg' || extension === '.jpeg'
    ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : extension === '.png'
      ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : extension === '.webp'
        ? buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
        : false;
  if (!valid) inputError(`Legacy upload ${filename} does not match its image extension.`);
  return extension === '.jpeg' ? '.jpg' : extension;
}

async function migrateBlobUploads(data) {
  if (storageProvider !== 'blob') return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    inputError('Set BLOB_READ_WRITE_TOKEN before migrating uploads to Blob.');
  }
  const { put } = require('@vercel/blob');
  const references = new Set();
  for (const profile of Object.values(data.profiles || {})) {
    if (typeof profile.photo === 'string' && profile.photo.startsWith('/uploads/')) references.add(profile.photo);
  }
  for (const projects of Object.values(data.projects || {})) {
    for (const project of Array.isArray(projects) ? projects : []) {
      if (typeof project.image === 'string' && project.image.startsWith('/uploads/')) references.add(project.image);
    }
  }

  const migrated = new Map();
  for (const reference of references) {
    const filename = reference.slice('/uploads/'.length);
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename)) {
      inputError(`Legacy upload reference is not a generated image name: ${reference}`);
    }
    const filePath = path.join(uploadsDir, filename);
    const buffer = fs.readFileSync(filePath);
    const extension = validateImage(filename, buffer);
    const contentType = extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'image/webp';
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true
    });
    migrated.set(reference, blob.url);
  }

  for (const profile of Object.values(data.profiles || {})) {
    if (migrated.has(profile.photo)) profile.photo = migrated.get(profile.photo);
  }
  for (const projects of Object.values(data.projects || {})) {
    for (const project of Array.isArray(projects) ? projects : []) {
      if (migrated.has(project.image)) project.image = migrated.get(project.image);
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    inputError('Set DATABASE_URL to the PostgreSQL database that the application will use.');
  }
  if (!['local', 'blob'].includes(storageProvider)) {
    inputError('STORAGE_PROVIDER must be local or blob.');
  }

  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!data.profiles || !data.services || !data.projects || !Array.isArray(data.enquiries)) {
    inputError('The input file does not match the expected site-data.json format.');
  }
  await migrateBlobUploads(data);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000
  });
  try {
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
    const result = replaceExisting
      ? await pool.query(
          `INSERT INTO application_state (state_key, state_data, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (state_key) DO UPDATE SET state_data = EXCLUDED.state_data, updated_at = NOW()`,
          ['site', JSON.stringify(data)]
        )
      : await pool.query(
          'INSERT INTO application_state (state_key, state_data) VALUES ($1, $2::jsonb) ON CONFLICT (state_key) DO NOTHING',
          ['site', JSON.stringify(data)]
        );
    if (!replaceExisting && result.rowCount === 0) {
      inputError('The database already contains application data. Back it up, then rerun with --replace only if replacing it is intended.');
    }
    console.log(`Imported site content from ${inputPath}${replaceExisting ? ' (existing application data replaced)' : ''}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  if (error.code === 'MIGRATION_INPUT') {
    console.error(`Data migration failed: ${error.message}`);
  } else if (error.code === 'ENOENT') {
    console.error('Data migration failed: input file or referenced local upload is missing. Check the input path and UPLOAD_DIR.');
  } else {
    console.error(`Data migration failed: ${error.code || error.name || 'unknown error'}`);
  }
  process.exitCode = 1;
});
