// ===============================
// Selfie Connect Backend (Face++ + Supabase)
// Route-registration wrapper -> eliminates any .stack reads
// Final debug-safe version
// ===============================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// -----------------------------
// Config
// -----------------------------
const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FACE_API_KEY = process.env.FACE_API_KEY;
const FACE_API_SECRET = process.env.FACE_API_SECRET;
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 60);

// quick env check
console.log('ENV CHECK:', {
  SUPABASE_URL: !!SUPABASE_URL,
  SUPABASE_KEY: !!SUPABASE_KEY,
  FACE_API_KEY: !!FACE_API_KEY,
  FACE_API_SECRET: !!FACE_API_SECRET,
  BACKEND_BASE_URL,
  CONFIDENCE_THRESHOLD
});

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL or SUPABASE_KEY missing in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -----------------------------
// App + upload setup
// -----------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
console.log('Upload dir ready:', UPLOAD_DIR);

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 5 * 1024 * 1024 } });

// log requests
app.use((req, _res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// -----------------------------
// ROUTE REGISTRATION WRAPPER
// -----------------------------
// NEVER read app._router.stack. Instead record routes when you register them.
const registeredRoutes = [];
function addRoute(method, path, ...handlers) {
  const m = method.toLowerCase();
  if (!app[m]) throw new Error('Invalid method: ' + method);
  app[m](path, ...handlers);
  registeredRoutes.push(`${method.toUpperCase()} ${path}`);
}

// -----------------------------
// Helpers: Face++ + Supabase
// -----------------------------
async function faceppDetect(filePath) {
  const form = new FormData();
  form.append('api_key', FACE_API_KEY);
  form.append('api_secret', FACE_API_SECRET);
  form.append('image_file', fs.createReadStream(filePath));
  const res = await axios.post('https://api-us.faceplusplus.com/facepp/v3/detect', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 30000
  });
  return res.data;
}

async function faceppCompare(token1, token2) {
  const form = new FormData();
  form.append('api_key', FACE_API_KEY);
  form.append('api_secret', FACE_API_SECRET);
  form.append('face_token1', token1);
  form.append('face_token2', token2);
  const res = await axios.post('https://api-us.faceplusplus.com/facepp/v3/compare', form, {
    headers: form.getHeaders(),
    timeout: 30000
  });
  return res.data;
}

async function uploadToSupabase(bucket, pathOnBucket, filePath, contentType = 'image/jpeg') {
  const stream = fs.createReadStream(filePath);
  const { error } = await supabase.storage.from(bucket).upload(pathOnBucket, stream, {
    contentType,
    upsert: false
  });
  if (error) throw error;
  return true;
}

// -----------------------------
// Endpoints (use addRoute so we track them)
// -----------------------------

// health
addRoute('get', '/', (_req, res) => res.json({ status: 'ok', message: 'Backend root alive 🚀' }));

// quick test
addRoute('get', '/test', (_req, res) => res.send('✅ test ok'));

// create-person (form-data: image file 'image', userId, name)
addRoute('post', '/create-person', upload.single('image'), async (req, res) => {
  try {
    const userId = req.body.userId;
    const name = req.body.name || 'person';
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!req.file) return res.status(400).json({ error: 'image required' });

    const detect = await faceppDetect(req.file.path);
    if (!detect?.faces?.length) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ created: false, reason: 'no_face_detected' });
    }

    const faceToken = detect.faces[0].face_token;
    const { data: personData, error: pErr } = await supabase
      .from('persons')
      .insert([{ owner_user_id: userId, name, face_token: faceToken }])
      .select()
      .single();
    if (pErr) throw pErr;

    const filename = `${Date.now()}.jpg`;
    const pathOnBucket = `users/${userId}/${personData.id}/${filename}`;
    await uploadToSupabase('selfies', pathOnBucket, req.file.path);
    await supabase.from('images').insert([{ owner_user_id: userId, person_id: personData.id, path: pathOnBucket }]);
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ created: true, personId: personData.id, faceToken });
  } catch (err) {
    console.error('create-person err:', (err && (err.stack || err)) );
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// verify-upload (form-data: image file 'image', userId)
addRoute('post', '/verify-upload', upload.single('image'), async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!req.file) return res.status(400).json({ error: 'image required' });

    const detect = await faceppDetect(req.file.path);
    if (!detect?.faces?.length) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.json({ match: false, reason: 'no_face_detected' });
    }

    const faceToken = detect.faces[0].face_token;
    const { data: persons, error: perr } = await supabase.from('persons').select('*').eq('owner_user_id', userId);
    if (perr) throw perr;

    for (const p of (persons || [])) {
      if (!p.face_token) continue;
      const cmp = await faceppCompare(faceToken, p.face_token);
      if (cmp?.confidence >= CONFIDENCE_THRESHOLD) {
        const folderPath = `users/${userId}/${p.id}/`;
        const listRes = await supabase.storage.from('selfies').list(folderPath, { limit: 100 });
        if (listRes.error) throw listRes.error;

        const signedUrls = [];
        for (const obj of listRes.data || []) {
          const created = await supabase.storage.from('selfies').createSignedUrl(folderPath + obj.name, 60);
          if (!created.error && created.data?.signedUrl) signedUrls.push(created.data.signedUrl);
        }

        try { fs.unlinkSync(req.file.path); } catch (e) {}
        return res.json({ match: true, personId: p.id, signedUrls });
      }
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ match: false });
  } catch (err) {
    console.error('verify-upload err:', (err && (err.stack || err)) );
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// generate-qr (body JSON { userId, personId?, ttlSeconds? })
addRoute('post', '/generate-qr', async (req, res) => {
  try {
    const { userId, personId } = req.body;
    const ttlSeconds = Number(req.body.ttlSeconds || 3600);
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const { error: insErr } = await supabase.from('shared_links').insert([{ owner_user_id: userId, person_id: personId || null, token, expires_at: expiresAt }]);
    if (insErr) throw insErr;

    const qrLink = `${BACKEND_BASE_URL.replace(/\/$/, '')}/access?token=${token}`;
    res.json({ qrLink, token, expiresAt });
  } catch (err) {
    console.error('generate-qr err:', (err && (err.stack || err)) );
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// access-json (GET ?token=)
addRoute('get', '/access-json', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'token required' });

    const { data: links, error: lErr } = await supabase.from('shared_links').select('*').eq('token', token).limit(1);
    if (lErr) throw lErr;
    if (!links?.length) return res.status(404).json({ error: 'invalid token' });

    const link = links[0];
    if (link.expires_at && new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'token expired' });

    const ownerId = link.owner_user_id;
    const personId = link.person_id;
    const files = [];

    if (personId) {
      const folderPath = `users/${ownerId}/${personId}/`;
      const listRes = await supabase.storage.from('selfies').list(folderPath, { limit: 100 });
      if (!listRes.error) listRes.data.forEach(f => files.push({ path: folderPath + f.name }));
    } else {
      const { data: persons } = await supabase.from('persons').select('id').eq('owner_user_id', ownerId);
      for (const p of (persons || [])) {
        const folderPath = `users/${ownerId}/${p.id}/`;
        const listRes = await supabase.storage.from('selfies').list(folderPath, { limit: 100 });
        if (!listRes.error) listRes.data.forEach(f => files.push({ path: folderPath + f.name }));
      }
    }

    const signedUrls = [];
    for (const f of files) {
      const { data: signedData } = await supabase.storage.from('selfies').createSignedUrl(f.path, 300);
      if (signedData?.signedUrl) signedUrls.push(signedData.signedUrl);
    }

    res.json({ signedUrls, personId: personId || null });
  } catch (err) {
    console.error('access-json err:', (err && (err.stack || err)) );
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// access HTML (browser)
addRoute('get', '/access', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send('token required');
    const resp = await axios.get(`${BACKEND_BASE_URL.replace(/\/$/, '')}/access-json?token=${encodeURIComponent(token)}`);
    const signed = resp.data.signedUrls || [];
    let html = `<html><head><title>Shared Gallery</title></head><body><h2>Shared Gallery</h2>`;
    for (const u of signed) html += `<div style="max-width:300px;margin:10px;display:inline-block"><img src="${u}" style="width:100%;height:auto"/></div>`;
    html += `</body></html>`;
    res.send(html);
  } catch (err) {
    console.error('access page err:', (err && (err.stack || err)) );
    res.status(500).send('server error');
  }
});

// debug-routes (returns registeredRoutes)
addRoute('get', '/debug-routes', (_req, res) => {
  res.json({ backend: 'Selfie Connect', env: process.env.NODE_ENV || 'development', routes: registeredRoutes });
});

// -----------------------------
// Global error handlers & process
// -----------------------------
app.use((err, _req, res, _next) => {
  console.error('GLOBAL ERROR:', (err && (err.stack || err)));
  res.status(500).json({ error: err?.message || 'internal error' });
});
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r && (r.stack || r)));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e && (e.stack || e)));

// -----------------------------
// Start the server
// -----------------------------
const server = app.listen(PORT, () => {
  console.log(`🚀 Selfie Connect backend running on ${PORT}`);
  // log registered routes (we use registeredRoutes, no internals)
  console.log('🧠 ROUTES REGISTERED:', registeredRoutes.length ? registeredRoutes : '⚠️ None registered');
});

// return server for tests if required
module.exports = server;
