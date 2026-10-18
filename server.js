const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const rootDir = 'c:\\Users\\Admin\\Desktop\\WORK STATION FOR FAMILY';
const publicDir = path.join(rootDir, 'public');
const uploadsDir = path.join(rootDir, 'uploads');
const dataDir = path.join(rootDir, 'data');
const dataFile = path.join(dataDir, 'site-data.json');
const port = process.env.PORT || 3000;

const roleNames = { electrician: 'Electrician', tailor: 'Tailor', developer: 'Developer' };
const passwords = {
  electrician: process.env.ELECTRICIAN_PASSWORD || 'ElectricianAdmin#2026',
  tailor: process.env.TAILOR_PASSWORD || 'TailorAdmin#2026',
  developer: process.env.DEVELOPER_PASSWORD || 'DeveloperAdmin#2026'
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
  enquiries: []
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

function ensureDataFile() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

function loadData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const data = JSON.parse(raw);
    let changed = false;
    data.enquiries = Array.isArray(data.enquiries) ? data.enquiries : [];
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
    if (changed) saveData(data);
    return data;
  } catch (error) {
    throw new Error(`Unable to load site content from ${dataFile}: ${error.message}`);
  }
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
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

const sessions = new Map();

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) result[name] = decodeURIComponent(rest.join('='));
  }
  return result;
}

function getSession(req) {
  const sid = parseCookies(req.headers.cookie).sessionId;
  return sid ? (sessions.get(sid) || null) : null;
}

function setSession(res, role) {
  const sid = crypto.randomBytes(18).toString('hex');
  sessions.set(sid, { role, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `sessionId=${sid}; Path=/; HttpOnly; SameSite=Lax`);
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
  for (const pair of raw.toString('utf8').split('&')) {
    if (!pair) continue;
    const [key, ...rest] = pair.split('=');
    if (!key) continue;
    result[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
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
          originalName: path.basename(filename[1]),
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
  if (file.buffer.length === 0 || file.buffer.length > 8 * 1024 * 1024) {
    throw new Error('Images must be smaller than 8 MB.');
  }
  const isJpeg = file.mimeType === 'image/jpeg' && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  const isPng = file.mimeType === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = file.mimeType === 'image/webp' && file.buffer.toString('ascii', 0, 4) === 'RIFF' && file.buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    throw new Error('The selected file does not match its JPEG, PNG, or WebP image type.');
  }
  return extension;
}

function saveUploadedImage(file) {
  const extension = validateUploadedImage(file);
  const filename = `${crypto.randomBytes(16).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(uploadsDir, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderHomePage() {
  const data = loadData();
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
          <label><span>Subject</span><input type="text" name="subject" placeholder="Electrical repair or tailoring request" required /></label>
          <label><span>Project details</span><textarea name="message" rows="5" placeholder="Please share your project details..." required></textarea></label>
          <div class="field-grid">
            <label><span>Preferred date</span><input type="date" name="date" /></label>
            <label><span>Budget</span><input type="text" name="budget" placeholder="Optional" /></label>
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

function renderProfilePage(role, enquirySent = false) {
  const data = loadData();
  const profile = data.profiles[role] || data.profiles.electrician;
  const services = data.services[role] || [];
  const projects = data.projects[role] || [];
  const serviceHtml = services.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description)}</p></li>`).join('');
  const projectHtml = projects.map((item) => {
    const comments = (item.comments || []).map((comment) => `<li><strong>${escapeHtml(comment.name)}</strong><p>${escapeHtml(comment.text)}</p></li>`).join('');
    return `<article class="project-card reveal"><img class="project-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" /><div class="project-copy"><span class="panel-tag">${escapeHtml(item.category || 'Project')}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><section class="project-comments" aria-label="Comments on ${escapeHtml(item.title)}"><h4>Appreciate this work</h4>${comments ? `<ul class="comment-list">${comments}</ul>` : '<p class="empty-comments">No comments yet. Be the first to appreciate this work.</p>'}<form method="POST" action="/comment" class="comment-form"><input type="hidden" name="role" value="${escapeHtml(role)}" /><input type="hidden" name="project_id" value="${escapeHtml(item.id)}" /><label><span>Your name</span><input type="text" name="name" maxlength="80" required /></label><label><span>Your comment</span><textarea name="text" rows="3" maxlength="1000" required></textarea></label><button type="submit" class="btn btn-secondary">Post comment</button></form></section></div></article>`;
  }).join('');

  const enquiryForm = `<form class="enquiry-form reveal" method="POST" action="/enquiry"><input type="hidden" name="role" value="${escapeHtml(role)}" /><label><span>Your name</span><input type="text" name="customer_name" maxlength="100" required /></label><label><span>How should ${role === 'tailor' ? 'the tailor' : role === 'electrician' ? 'the electrician' : 'the developer'} contact you?</span><select name="contact_method" required><option value="WhatsApp">WhatsApp</option><option value="Email">Email</option></select></label><label><span>Your WhatsApp number or email address</span><input type="text" name="customer_contact" maxlength="254" autocomplete="email" placeholder="Enter your WhatsApp number or email" required /></label><label><span>${role === 'tailor' ? 'Garment or service required' : role === 'electrician' ? 'Project or service' : 'Project required'}</span><input type="text" name="subject" maxlength="160" required /></label><label><span>Project details</span><textarea name="message" rows="5" maxlength="3000" required></textarea></label>${role === 'tailor' ? '<div class="field-grid"><label><span>Preferred date</span><input type="date" name="date" /></label><label><span>Budget range</span><input type="text" name="budget" maxlength="100" /></label></div>' : ''}<button class="btn btn-primary" type="submit">Send enquiry</button></form>`;
  const contactForm = enquiryForm;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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

function renderDashboardPage(role) {
  const data = loadData();
  const profile = data.profiles[role] || data.profiles.electrician;
  const services = data.services[role] || [];
  const projects = data.projects[role] || [];
  const enquiries = data.enquiries.filter((item) => item.role === role).slice().reverse();
  const enquiryList = enquiries.length
    ? enquiries.map((item) => {
      const contactLink = item.contact_method === 'WhatsApp'
        ? `https://wa.me/${whatsappNumber(item.customer_contact)}`
        : `mailto:${encodeURIComponent(item.customer_contact || '')}`;
      return `<article class="enquiry-item"><div class="enquiry-heading"><h4>${escapeHtml(item.subject || 'Service enquiry')}</h4><time>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : '')}</time></div><p><strong>${escapeHtml(item.customer_name)}</strong> — ${escapeHtml(item.message)}</p><p>Preferred contact: <a href="${contactLink}" ${item.contact_method === 'WhatsApp' ? 'target="_blank" rel="noreferrer"' : ''}>${escapeHtml(item.contact_method)}: ${escapeHtml(item.customer_contact)}</a></p>${item.date ? `<p>Preferred date: ${escapeHtml(item.date)}</p>` : ''}${item.budget ? `<p>Budget: ${escapeHtml(item.budget)}</p>` : ''}</article>`;
    }).join('')
    : '<p class="empty-comments">No enquiries received yet.</p>';

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
          <a class="btn btn-secondary" href="/" target="_blank" rel="noreferrer">Preview site</a>
        </div>

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
              <label><span>Choose a JPEG, PNG, or WebP image (max 8 MB)</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label>
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
            <label><span>Photo (JPEG, PNG, or WebP; max 8 MB)</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label>
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
  <script src="/js/main.js"></script>
</body>
</html>`;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/login') {
    const body = parseFormData(await readBody(req));
    const role = body.role;
    const password = body.password || '';
    if (!role || !password || password !== (passwords[role] || '')) {
      return sendHtml(res, renderLoginPage('Incorrect password or role. Please try again.'), 401);
    }
    setSession(res, role);
    return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
  }

  if (req.method === 'GET' && pathname === '/logout') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.sessionId) sessions.delete(cookies.sessionId);
    res.setHeader('Set-Cookie', 'sessionId=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return redirect(res, '/');
  }

  if (req.method === 'POST' && pathname === '/enquiry') {
    const body = parseFormData(await readBody(req));
    const contactIsValid = body.contact_method === 'WhatsApp'
      ? /^[+()\d\s-]{7,24}$/.test(body.customer_contact || '') && /\d/.test(body.customer_contact || '')
      : body.contact_method === 'Email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customer_contact || '');
    if (!roleNames[body.role] || !['WhatsApp', 'Email'].includes(body.contact_method) ||
        !body.customer_name || !body.customer_contact || !body.subject || !body.message ||
        body.customer_name.length > 100 || body.customer_contact.length > 254 ||
        body.subject.length > 160 || body.message.length > 3000 || !contactIsValid) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Please provide your name, enquiry details, and a WhatsApp number or email address.</h1><p><a href="/">Return to the website</a></p></body></html>', 400);
    }
    const data = loadData();
    data.enquiries.push({
      role: body.role,
      customer_name: body.customer_name.slice(0, 100),
      contact_method: body.contact_method,
      customer_contact: body.customer_contact.slice(0, 254),
      subject: body.subject.slice(0, 160),
      message: body.message.slice(0, 3000),
      date: body.date || '',
      budget: body.budget || '',
      created_at: new Date().toISOString()
    });
    saveData(data);
    const profilePath = body.role === 'tailor' ? 'tailoring' : body.role;
    return redirect(res, `/${profilePath}.html?enquiry=sent#contact`);
  }

  if (req.method === 'POST' && pathname === '/comment') {
    const body = parseFormData(await readBody(req));
    if (!roleNames[body.role] || !body.project_id || !body.name.trim() || !body.text.trim() ||
        body.name.length > 80 || body.text.length > 1000) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>Please enter your name and a comment of up to 1,000 characters.</h1><p><a href="/">Return to the website</a></p></body></html>', 400);
    }
    const data = loadData();
    const project = (data.projects[body.role] || []).find((item) => item.id === body.project_id);
    if (!project) {
      return sendHtml(res, '<!DOCTYPE html><html lang="en"><body><h1>That work post could not be found.</h1><p><a href="/">Return to the website</a></p></body></html>', 404);
    }
    project.comments.push({
      name: body.name.trim(),
      text: body.text.trim(),
      created_at: new Date().toISOString()
    });
    saveData(data);
    const profilePath = body.role === 'tailor' ? 'tailoring' : body.role;
    return redirect(res, `/${profilePath}.html#work`);
  }

  if (req.method === 'POST' && pathname.startsWith('/dashboard/')) {
    const parts = pathname.split('/').filter(Boolean);
    const role = parts[1];
    if (!roleNames[role]) {
      return sendHtml(res, 'Unknown role', 404);
    }

    const session = getSession(req);
    if (!session || session.role !== role) {
      return redirect(res, '/login.html');
    }

    const action = parts[2];
    if (action === 'upload-profile' || action === 'upload-project') {
      let upload;
      try {
        const raw = await readBody(req, 8 * 1024 * 1024 + 128 * 1024);
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
      const image = saveUploadedImage(upload.file);
      const data = loadData();
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
      saveData(data);
      return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
    }

    const body = parseFormData(await readBody(req));
    const data = loadData();

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

    saveData(data);
    return redirect(res, `/dashboard.html?role=${encodeURIComponent(role)}`);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendHtml(res, renderHomePage());
  }

  if (pathname === '/electrician.html' || pathname === '/electrician') {
    return sendHtml(res, renderProfilePage('electrician', url.searchParams.get('enquiry') === 'sent'));
  }

  if (pathname === '/tailoring.html' || pathname === '/tailoring') {
    return sendHtml(res, renderProfilePage('tailor', url.searchParams.get('enquiry') === 'sent'));
  }

  if (pathname === '/developer.html' || pathname === '/developer') {
    return sendHtml(res, renderProfilePage('developer', url.searchParams.get('enquiry') === 'sent'));
  }

  if (pathname === '/login.html' || pathname === '/login') {
    const session = getSession(req);
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
    const session = getSession(req);
    if (!session || session.role !== role) {
      return redirect(res, '/login.html');
    }
    return sendHtml(res, renderDashboardPage(role));
  }

  if (pathname === '/robots.txt') {
    return sendHtml(res, 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n');
  }

  if (pathname === '/sitemap.xml') {
    return sendHtml(res, '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/electrician.html</loc></url><url><loc>https://example.com/tailoring.html</loc></url><url><loc>https://example.com/developer.html</loc></url><url><loc>https://example.com/login.html</loc></url></urlset>');
  }

  if (pathname.startsWith('/uploads/')) {
    const filename = pathname.slice('/uploads/'.length);
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename)) {
      return sendHtml(res, 'Not found', 404);
    }
    const uploadedPath = path.join(uploadsDir, filename);
    if (!fs.existsSync(uploadedPath) || !fs.statSync(uploadedPath).isFile()) {
      return sendHtml(res, 'Not found', 404);
    }
    const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(filename)];
    res.writeHead(200, {
      'Content-Type': mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400'
    });
    return fs.createReadStream(uploadedPath).pipe(res);
  }

  const requestedPath = pathname.replace(/^\//, '');
  const publicPath = path.join(publicDir, requestedPath);
  if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
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
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    return res.end(content);
  }

  return sendHtml(res, '<!DOCTYPE html><html><body><h1>Page not found</h1></body></html>', 404);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendHtml(res, '<!DOCTYPE html><html><body><h1>Server error</h1></body></html>', 500);
  });
});

server.listen(port, () => {
  console.log(`Craft & Current running at http://localhost:${port}`);
});
