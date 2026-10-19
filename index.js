const express = require('express');
const path = require('path');
const handleRequest = require('./server');

const app = express();
const publicDir = path.join(__dirname, 'public');
const isVercel = process.env.VERCEL === '1';

app.disable('x-powered-by');
app.set('trust proxy', isVercel || process.env.TRUST_PROXY === 'true');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.static(publicDir, {
  dotfiles: 'deny',
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.use((req, res, next) => {
  handleRequest(req, res).catch(next);
});

app.use((error, req, res, next) => {
  console.error('Request failed:', error.code || error.name || 'unknown error');
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).type('html').send('<!DOCTYPE html><html><body><h1>Server error</h1></body></html>');
});

module.exports = app;

if (require.main === module) {
  try {
    handleRequest.validateConfiguration();
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
    app.listen(port, host, () => {
      console.log(`Craft & Current running at http://${host}:${port}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
