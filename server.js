// ===============================
// Selfie Connect Backend (Face++ + Supabase)
// ✅ Final stable version (Render-safe, Node 20+ compatible)
// ===============================
import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// -----------------------------
// Config
// -----------------------------
const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FACE_API_KEY = process.env.FACE_API_KEY;
const FACE_API_SECRET = process.env.FACE_API_SECRET;
const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL || `http://localhost:${PORT}`;
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 60);

console.log("✅ ENV CHECK:", {
  SUPABASE_URL: !!SUPABASE_URL,
  SUPABASE_KEY: !!SUPABASE_KEY,
  FACE_API_KEY: !!FACE_API_KEY,
  FACE_API_SECRET: !!FACE_API_SECRET,
  BACKEND_BASE_URL,
  CONFIDENCE_THRESHOLD,
});

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials. Check .env file!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -----------------------------
// Express + Multer
// -----------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ In-memory upload (Render-safe)
const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------
// Helper: Face++ functions
// -----------------------------
async function faceppDetectFromBuffer(buffer) {
  const form = new FormData();
  form.append("api_key", FACE_API_KEY);
  form.append("api_secret", FACE_API_SECRET);
  form.append("image_file", buffer, "upload.jpg");

  const res = await axios.post(
    "https://api-us.faceplusplus.com/facepp/v3/detect",
    form,
    {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 30000,
    }
  );
  return res.data;
}

async function faceppCompare(token1, token2) {
  const form = new FormData();
  form.append("api_key", FACE_API_KEY);
  form.append("api_secret", FACE_API_SECRET);
  form.append("face_token1", token1);
  form.append("face_token2", token2);

  const res = await axios.post(
    "https://api-us.faceplusplus.com/facepp/v3/compare",
    form,
    { headers: form.getHeaders(), timeout: 30000 }
  );
  return res.data;
}

// -----------------------------
// ✅ Upload to Supabase (duplex fix for Node 20)
// -----------------------------
async function uploadToSupabase(bucket, pathOnBucket, fileBuffer) {
  // Use fetch manually instead of supabase-js internal upload
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(
    pathOnBucket
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "image/jpeg",
    },
    body: fileBuffer,
    duplex: "half", // ✅ required for Node 18/20+
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upload failed: ${res.status} ${text}`);
  }
  return true;
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (_req, res) =>
  res.json({ status: "ok", message: "Backend running 🚀" })
);

app.get("/test", (_req, res) => res.send("✅ test ok"));

// ✅ Create Person
app.post("/create-person", upload.single("image"), async (req, res) => {
  try {
    const { userId, name } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!req.file?.buffer)
      return res.status(400).json({ error: "image required" });

    const detect = await faceppDetectFromBuffer(req.file.buffer);
    if (!detect?.faces?.length)
      return res
        .status(400)
        .json({ created: false, reason: "no_face_detected" });

    const faceToken = detect.faces[0].face_token;

    const { data: person, error: pErr } = await supabase
      .from("persons")
      .insert([
        { owner_user_id: userId, name: name || "person", face_token: faceToken },
      ])
      .select()
      .single();
    if (pErr) throw pErr;

    const fileName = `${Date.now()}.jpg`;
    const pathOnBucket = `users/${userId}/${person.id}/${fileName}`;

    await uploadToSupabase("selfies", pathOnBucket, req.file.buffer);

    await supabase
      .from("images")
      .insert([{ owner_user_id: userId, person_id: person.id, path: pathOnBucket }]);

    res.json({ created: true, personId: person.id, faceToken });
  } catch (err) {
    console.error("create-person error:", err);
    res.status(500).json({ error: err.message || "server error" });
  }
});

// ✅ VERIFY-UPLOAD (Compare uploaded selfie with stored Face++)
app.post("/verify-upload", upload.single("image"), async (req, res) => {
  try {
    console.log("📩 VERIFY-UPLOAD triggered");

    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!req.file?.buffer)
      return res.status(400).json({ error: "image file required" });

    // Detect face from uploaded buffer
    const detect = await faceppDetectFromBuffer(req.file.buffer);
    if (!detect?.faces?.length)
      return res
        .status(400)
        .json({ match: false, reason: "no_face_detected_in_uploaded_image" });

    const faceToken = detect.faces[0].face_token;

    // Fetch stored persons for this user
    const { data: persons, error: pErr } = await supabase
      .from("persons")
      .select("*")
      .eq("owner_user_id", userId);

    if (pErr) throw pErr;
    if (!persons?.length)
      return res.status(404).json({ error: "no_person_records_found" });

    console.log(`🧠 Found ${persons.length} persons for user ${userId}`);

    // Compare uploaded face with each saved face token
    for (const p of persons) {
      console.log(`🔍 Comparing with person ${p.id} (${p.name})`);
      const cmp = await faceppCompare(faceToken, p.face_token);

      if (cmp.confidence >= CONFIDENCE_THRESHOLD) {
        console.log(
          `✅ Match found: confidence ${cmp.confidence} >= ${CONFIDENCE_THRESHOLD}`
        );

        const folderPath = `users/${userId}/${p.id}/`;
        const listRes = await supabase.storage
          .from("selfies")
          .list(folderPath, { limit: 100 });

        const signedUrls = [];
        for (const obj of listRes.data || []) {
          const signed = await supabase.storage
            .from("selfies")
            .createSignedUrl(folderPath + obj.name, 120);
          if (signed.data?.signedUrl) signedUrls.push(signed.data.signedUrl);
        }

        return res.json({
          match: true,
          personId: p.id,
          confidence: cmp.confidence,
          signedUrls,
        });
      }
    }

    // No match found
    console.log("❌ No matching person found.");
    res.json({ match: false });
  } catch (err) {
    console.error("verify-upload error:", err);
    res.status(500).json({ error: err.message || "server error" });
  }
});


// ✅ Generate QR
app.post("/generate-qr", async (req, res) => {
  try {
    const { userId, personId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1h

    const { error } = await supabase.from("shared_links").insert([
      {
        owner_user_id: userId,
        person_id: personId || null,
        token,
        expires_at: expiresAt,
      },
    ]);
    if (error) throw error;

    const qrLink = `${BACKEND_BASE_URL}/access?token=${token}`;
    res.json({ qrLink, token, expiresAt });
  } catch (err) {
    console.error("generate-qr error:", err);
    res.status(500).json({ error: err.message || "server error" });
  }
});


// ✅ Return signed URLs JSON for gallery token (final, stable version)
app.get("/access-json", async (req, res) => {
  try {
    const token = req.query.token?.trim();
    if (!token) return res.status(400).json({ error: "Token required" });

    // 🔍 Fetch the matching shared link
    const { data: link, error } = await supabase
      .from("shared_links")
      .select("owner_user_id, person_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!link) return res.status(404).json({ error: "Invalid or expired token" });

    // ⏰ Check expiry
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: "Token expired" });
    }

    const { owner_user_id, person_id } = link;
    if (!owner_user_id || !person_id)
      return res.status(400).json({ error: "Missing owner or person info" });

    // 📂 Folder path in Supabase
    const folderPath = `users/${owner_user_id}/${person_id}/`;

    // 🧾 List files in the folder
    const listRes = await supabase.storage.from("selfies").list(folderPath, { limit: 100 });
    if (listRes.error) throw new Error(listRes.error.message);

    // 🔗 Generate signed URLs for each image
    const signedUrls = [];
    for (const file of listRes.data || []) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("selfies")
        .createSignedUrl(folderPath + file.name, 300); // 5 min validity
      if (signErr) console.warn("Signed URL error:", signErr.message);
      else if (signed?.signedUrl) signedUrls.push(signed.signedUrl);
    }

    if (!signedUrls.length)
      return res.json({ signedUrls: [], message: "No photos found for this token" });

    res.json({ signedUrls });
  } catch (err) {
    console.error("access-json error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});



// ✅ VIP ACCESS PAGE (stable, glowing FYP style + error-safe)
app.get("/access", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("❌ Token required");

    const safeBase = BACKEND_BASE_URL.replace(/\/$/, ""); // avoid double slashes
    const jsonUrl = `${safeBase}/access-json?token=${encodeURIComponent(token)}`;

    let signedUrls = [];
    let errorMsg = "";

    try {
      const resp = await axios.get(jsonUrl, { timeout: 15000 });
      if (resp.status === 200 && Array.isArray(resp.data?.signedUrls)) {
        signedUrls = resp.data.signedUrls;
      } else if (resp.status === 404) {
        errorMsg = "Invalid or unknown token ❌";
      } else if (resp.status === 410) {
        errorMsg = "This link has expired 🕒";
      } else {
        errorMsg = resp.data?.error || "Unable to fetch shared photos.";
      }
    } catch (e) {
      console.error("access axios error:", e?.message || e);
      errorMsg = "Server could not retrieve the shared gallery.";
    }

    if (!signedUrls.length) {
      return res.send(`
        <html>
          <head>
            <title>Selfie Connect | Gallery</title>
            <style>
              body {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background: radial-gradient(circle at top, #1e1e2f, #111122);
                color: #eee;
                font-family: "Poppins", sans-serif;
                text-align: center;
              }
              h2 {
                font-size: 24px;
                color: #ff4ef0;
                text-shadow: 0 0 10px #ff4ef0;
              }
            </style>
          </head>
          <body>
            <div>
              <h2>${errorMsg || "No photos available or token expired 🕒"}</h2>
              <p>Please ask the owner to generate a new QR link.</p>
            </div>
          </body>
        </html>
      `);
    }

    // 🎨 VIP glowing FYP-style gallery
    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Selfie Connect | Shared Gallery</title>
          <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 0;
              font-family: 'Poppins', sans-serif;
              background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
              color: #fff;
              text-align: center;
              overflow-x: hidden;
            }
            h1 {
              margin-top: 40px;
              font-size: 2.5rem;
              background: linear-gradient(90deg, #00ffcc, #ff00ff);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              animation: glow 2s ease-in-out infinite alternate;
            }
            @keyframes glow {
              from { text-shadow: 0 0 10px #00ffcc, 0 0 20px #00ffcc; }
              to { text-shadow: 0 0 20px #ff00ff, 0 0 40px #ff00ff; }
            }
            .gallery {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
              gap: 20px;
              padding: 30px;
              margin-top: 30px;
              max-width: 1200px;
              margin-left: auto;
              margin-right: auto;
            }
            .photo-card {
              position: relative;
              border-radius: 15px;
              overflow: hidden;
              box-shadow: 0 0 25px rgba(0, 255, 204, 0.3);
              transition: transform 0.3s ease, box-shadow 0.3s ease;
            }
            .photo-card:hover {
              transform: scale(1.05);
              box-shadow: 0 0 35px rgba(255, 0, 255, 0.4);
            }
            img {
              width: 100%;
              height: 100%;
              object-fit: cover;
              display: block;
            }
            footer {
              margin-top: 40px;
              padding: 20px;
              font-size: 0.9rem;
              color: #ccc;
              background: rgba(0,0,0,0.2);
              border-top: 1px solid rgba(255,255,255,0.1);
            }
          </style>
        </head>
        <body>
          <h1>📸 Selfie Connect Gallery</h1>
          <div class="gallery">
            ${signedUrls.map(url => `
              <div class="photo-card">
                <img src="${url}" alt="selfie" loading="lazy"/>
              </div>
            `).join("")}
          </div>
          <footer>Powered by <strong>Selfie Connect</strong> • Face++ + Supabase</footer>
        </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error("access page error (outer catch):", err);
    res.status(500).send("⚠️ Server error while loading shared gallery.");
  }
});



// ✅ Debug Routes
app.get("/debug-routes", (_req, res) =>
  res.json({
    backend: "Selfie Connect",
    routes: [
      "GET /test",
      "POST /create-person",
      "POST /verify-upload",
      "POST /generate-qr",
      "GET /access-json",
    ],
  })
);

// -----------------------------
// Start Server
// -----------------------------
app.listen(PORT, () =>
  console.log(`🚀 Selfie Connect backend running on port ${PORT}`)
);
