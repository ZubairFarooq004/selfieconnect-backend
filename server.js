// // server.js
// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const bodyParser = require("body-parser");
// const jwt = require("jsonwebtoken");
// const { createClient } = require("@supabase/supabase-js");

// // HTML escaping helper
// const escapeHtml = (s) =>
//   String(s).replace(/[&<>"']/g, (c) => ({
//     "&": "&amp;",
//     "<": "&lt;",
//     ">": "&gt;",
//     '"': "&quot;",
//     "'": "&#39;",
//   }[c]));

// // 🔑 Environment
// const PORT = process.env.PORT || 5000;
// const SUPABASE_URL = process.env.SUPABASE_URL;
// const SUPABASE_KEY = process.env.SUPABASE_KEY; // must be service_role
// const JWT_SECRET = process.env.JWT_SECRET || "change_this";
// const PUBLIC_URL =
//   process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// if (!SUPABASE_URL || !SUPABASE_KEY) {
//   console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
//   process.exit(1);
// }

// console.log("✅ SUPABASE_URL:", SUPABASE_URL);
// console.log("✅ JWT_SECRET (first 6 chars):", JWT_SECRET.slice(0, 6));
// console.log("🌍 PUBLIC_URL:", PUBLIC_URL);

// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// const app = express();
// app.use(cors());
// app.use(bodyParser.json());

// /* -----------------------------
//    🌍 Health Endpoints
// ------------------------------ */
// app.get("/", (req, res) =>
//   res.json({ status: "ok", message: "Backend root alive 🚀" })
// );
// app.get("/api/health", (req, res) =>
//   res.json({ status: "ok", message: "Backend running 🚀" })
// );

// /* -----------------------------
//    🎫 Generate QR
// ------------------------------ */
// app.post("/generate-qr", async (req, res) => {
//   try {
//     const { userId, singleUse = false } = req.body;
//     if (!userId) return res.status(400).json({ error: "userId required" });

//     const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });

//     if (singleUse) {
//       await supabase.from("qr_tokens").insert([
//         { token, user_id: userId, used: false },
//       ]);
//     }

//     const encoded = encodeURIComponent(token);

//     // Always use Render's PUBLIC_URL if provided
//     const link = `${PUBLIC_URL}/view?token=${encoded}`;
//     const apiAccess = `${PUBLIC_URL}/access-json?token=${encoded}`;

//     res.json({ qrLink: link, apiAccess, token, expiresIn: "1h" });
//   } catch (e) {
//     console.error("/generate-qr error:", e);
//     res.status(500).json({ error: e.message || e });
//   }
// });

// /* -----------------------------
//    📂 JSON API
// ------------------------------ */
// app.get("/access-json", async (req, res) => {
//   try {
//     const token =
//       req.query.token ||
//       req.headers["authorization"]?.split(" ")[1];
//     if (!token) return res.status(400).json({ error: "token required" });

//     let decoded;
//     try {
//       decoded = jwt.verify(token, JWT_SECRET);
//     } catch (err) {
//       console.error("JWT verify failed:", err.message);
//       return res.status(401).json({ error: "Invalid or expired token" });
//     }
//     const userId = decoded.userId;

//     const { data: files, error } = await supabase.storage
//       .from("selfies")
//       .list(userId);
//     if (error) return res.status(500).json({ error: error.message });
//     if (!files || files.length === 0)
//       return res.json({ userId, files: [] });

//     const signed = await Promise.all(
//       files.map(async (f) => {
//         const { data, error: se } = await supabase.storage
//           .from("selfies")
//           .createSignedUrl(`${userId}/${f.name}`, 300);
//         if (se) return null;
//         const url =
//           data?.signedUrl ?? data?.signed_url ?? null;
//         return { name: f.name, url };
//       })
//     );

//     res.json({ userId, files: signed.filter(Boolean) });
//   } catch (e) {
//     console.error("/access-json error:", e);
//     res.status(500).json({ error: e.message || e });
//   }
// });

// /* -----------------------------
//    🌐 Friendly HTML view
// ------------------------------ */
// app.get("/view", async (req, res) => {
//   try {
//     const token = req.query.token;
//     if (!token) return res.status(400).send("token required");

//     let decoded;
//     try {
//       decoded = jwt.verify(token, JWT_SECRET);
//     } catch (err) {
//       return res.status(401).send("Invalid or expired token");
//     }
//     const userId = decoded.userId;

//     const { data: files } = await supabase.storage
//       .from("selfies")
//       .list(userId);
//     if (!files || files.length === 0) {
//       return res.send(`<h3>No images found for user ${escapeHtml(userId)}</h3>`);
//     }

//     const signed = await Promise.all(
//       files.map(async (f) => {
//         const { data } = await supabase.storage
//           .from("selfies")
//           .createSignedUrl(`${userId}/${f.name}`, 300);
//         return { name: f.name, url: data?.signedUrl ?? null };
//       })
//     );

//     const imgs = signed
//       .filter((s) => s && s.url)
//       .map(
//         (s) =>
//           `<div style="margin:8px"><img src="${escapeHtml(
//             s.url
//           )}" style="max-width:100%;height:auto"/></div>`
//       )
//       .join("\n");

//     return res.send(`
//       <html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
//       <title>Images for ${escapeHtml(userId)}</title></head>
//       <body>
//         <h3>Images for ${escapeHtml(userId)}</h3>
//         ${imgs}
//       </body></html>
//     `);
//   } catch (e) {
//     console.error("/view error:", e);
//     res.status(500).send("Server error");
//   }
// });

// /* -----------------------------
//    🚀 Start server
// ------------------------------ */
// app.listen(PORT, () =>
//   console.log(`🚀 Server running on ${PUBLIC_URL}`)
// );


// ===============================
// Selfie Connect Backend (Face++ + Supabase)
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

// ----- Config from .env -----
const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FACE_API_KEY = process.env.FACE_API_KEY;
const FACE_API_SECRET = process.env.FACE_API_SECRET;
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || `http://localhost:${PORT}`;
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 80);

// ----- Safety checks -----
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}
if (!FACE_API_KEY || !FACE_API_SECRET) {
  console.warn('⚠️ Face++ keys missing — face verification endpoints will fail until added.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ----- Express setup -----
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads dir exists
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('✅ Upload dir ready:', UPLOAD_DIR);
} catch (e) {
  console.error('❌ Cannot create upload dir:', e);
}

// Multer setup
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Simple logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root health check
app.get('/', (_req, res) => res.json({ status: 'ok', message: 'Backend root alive 🚀' }));

// ---- Safe Debug Route ----
app.get('/debug-routes', (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods)
          .map(m => m.toUpperCase())
          .join(', ');
        routes.push(`${methods} ${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle.stack) {
        layer.handle.stack.forEach((nested) => {
          if (nested.route && nested.route.path) {
            const methods = Object.keys(nested.route.methods)
              .map(m => m.toUpperCase())
              .join(', ');
            routes.push(`${methods} ${nested.route.path}`);
          }
        });
      }
    });
    return res.json({ routes });
  } catch (err) {
    console.error('debug-routes error:', err);
    return res.status(500).json({ error: err.message || 'debug error' });
  }
});

// ===============================
// Helper functions
// ===============================

// ---- Face++ Detect ----
async function faceppDetect(filePath) {
  const form = new FormData();
  form.append('api_key', FACE_API_KEY);
  form.append('api_secret', FACE_API_SECRET);
  form.append('image_file', fs.createReadStream(filePath));
  const res = await axios.post('https://api-us.faceplusplus.com/facepp/v3/detect', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return res.data;
}

// ---- Face++ Compare ----
async function faceppCompare(token1, token2) {
  const form = new FormData();
  form.append('api_key', FACE_API_KEY);
  form.append('api_secret', FACE_API_SECRET);
  form.append('face_token1', token1);
  form.append('face_token2', token2);
  const res = await axios.post('https://api-us.faceplusplus.com/facepp/v3/compare', form, {
    headers: form.getHeaders()
  });
  return res.data;
}

// ---- Supabase Upload ----
async function uploadToSupabase(bucket, pathOnBucket, filePath, contentType = 'image/jpeg') {
  const stream = fs.createReadStream(filePath);
  const { error } = await supabase.storage.from(bucket).upload(pathOnBucket, stream, {
    contentType,
    upsert: false
  });
  if (error) throw error;
  return true;
}

// ===============================
// Endpoints
// ===============================

// ---- Create Person ----
app.post('/create-person', upload.single('image'), async (req, res) => {
  try {
    const userId = req.body.userId;
    const name = req.body.name || 'person';
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!req.file) return res.status(400).json({ error: 'image file required' });

    const detect = await faceppDetect(req.file.path);
    if (!detect?.faces?.length) {
      fs.unlinkSync(req.file.path);
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
    fs.unlinkSync(req.file.path);

    res.json({ created: true, personId: personData.id, faceToken });
  } catch (err) {
    console.error('create-person err', err);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ---- Verify Upload ----
app.post('/verify-upload', upload.single('image'), async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!req.file) return res.status(400).json({ error: 'image file required' });

    const detect = await faceppDetect(req.file.path);
    if (!detect?.faces?.length) {
      fs.unlinkSync(req.file.path);
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
        for (const obj of listRes.data) {
          const create = await supabase.storage.from('selfies').createSignedUrl(folderPath + obj.name, 60);
          if (!create.error) signedUrls.push(create.data.signedUrl);
        }

        fs.unlinkSync(req.file.path);
        return res.json({ match: true, personId: p.id, signedUrls });
      }
    }

    fs.unlinkSync(req.file.path);
    res.json({ match: false });
  } catch (err) {
    console.error('verify-upload err', err);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ---- Generate QR ----
app.post('/generate-qr', async (req, res) => {
  try {
    const { userId, personId } = req.body;
    const ttlSeconds = Number(req.body.ttlSeconds || 3600);
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const { error: insErr } = await supabase
      .from('shared_links')
      .insert([{ owner_user_id: userId, person_id: personId || null, token, expires_at: expiresAt }]);
    if (insErr) throw insErr;

    const qrLink = `${BACKEND_BASE_URL.replace(/\/$/, '')}/access?token=${token}`;
    res.json({ qrLink, token, expiresAt });
  } catch (err) {
    console.error('generate-qr err', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Access JSON ----
app.get('/access-json', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'token required' });

    const { data: links, error: lErr } = await supabase.from('shared_links').select('*').eq('token', token).limit(1);
    if (lErr) throw lErr;
    if (!links?.length) return res.status(404).json({ error: 'invalid token' });

    const link = links[0];
    if (link.expires_at && new Date(link.expires_at) < new Date())
      return res.status(410).json({ error: 'token expired' });

    const ownerId = link.owner_user_id;
    const personId = link.person_id;
    let files = [];

    if (personId) {
      const folderPath = `users/${ownerId}/${personId}/`;
      const listRes = await supabase.storage.from('selfies').list(folderPath, { limit: 100 });
      if (!listRes.error)
        listRes.data.forEach(f => files.push({ path: folderPath + f.name }));
    } else {
      const { data: persons } = await supabase.from('persons').select('id').eq('owner_user_id', ownerId);
      for (const p of (persons || [])) {
        const folderPath = `users/${ownerId}/${p.id}/`;
        const listRes = await supabase.storage.from('selfies').list(folderPath, { limit: 100 });
        if (!listRes.error)
          listRes.data.forEach(f => files.push({ path: folderPath + f.name }));
      }
    }

    const signedUrls = [];
    for (const f of files) {
      const { data: signedData } = await supabase.storage.from('selfies').createSignedUrl(f.path, 300);
      if (signedData) signedUrls.push(signedData.signedUrl);
    }

    res.json({ signedUrls, personId: personId || null });
  } catch (err) {
    console.error('access-json err', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Access HTML (for browser) ----
app.get('/access', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send('token required');

    const resp = await axios.get(`${BACKEND_BASE_URL.replace(/\/$/, '')}/access-json?token=${encodeURIComponent(token)}`);
    const signed = resp.data.signedUrls || [];
    let html = `<html><head><title>Shared Gallery</title></head><body><h2>Shared Gallery</h2>`;
    for (const u of signed)
      html += `<div style="max-width:300px;margin:10px;display:inline-block"><img src="${u}" style="width:100%;height:auto"/></div>`;
    html += `</body></html>`;
    res.send(html);
  } catch (err) {
    console.error('access page err', err);
    res.status(500).send('server error');
  }
});

// ===============================
// Start Server
// ===============================
app.listen(PORT, () => console.log(`🚀 Selfie Connect backend running on ${PORT}`));
