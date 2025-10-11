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

// ✅ Verify Upload
app.post("/verify-upload", upload.single("image"), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!req.file?.buffer)
      return res.status(400).json({ error: "image required" });

    const detect = await faceppDetectFromBuffer(req.file.buffer);
    if (!detect?.faces?.length)
      return res.json({ match: false, reason: "no_face_detected" });

    const faceToken = detect.faces[0].face_token;
    const { data: persons } = await supabase
      .from("persons")
      .select("*")
      .eq("owner_user_id", userId);

    for (const p of persons || []) {
      const cmp = await faceppCompare(faceToken, p.face_token);
      if (cmp.confidence >= CONFIDENCE_THRESHOLD) {
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

        return res.json({ match: true, personId: p.id, signedUrls });
      }
    }

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
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    await supabase.from("shared_links").insert([
      {
        owner_user_id: userId,
        person_id: personId || null,
        token,
        expires_at: expiresAt,
      },
    ]);

    const qrLink = `${BACKEND_BASE_URL}/access?token=${token}`;
    res.json({ qrLink, token, expiresAt });
  } catch (err) {
    console.error("generate-qr error:", err);
    res.status(500).json({ error: err.message || "server error" });
  }
});

// ✅ Access JSON
app.get("/access-json", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: "token required" });

    const { data: links } = await supabase
      .from("shared_links")
      .select("*")
      .eq("token", token)
      .limit(1);

    if (!links?.length) return res.status(404).json({ error: "invalid token" });
    const link = links[0];

    if (new Date(link.expires_at) < new Date())
      return res.status(410).json({ error: "token expired" });

    const ownerId = link.owner_user_id;
    const personId = link.person_id;
    const signedUrls = [];

    const folderPath = `users/${ownerId}/${personId}/`;
    const listRes = await supabase.storage
      .from("selfies")
      .list(folderPath, { limit: 100 });

    for (const f of listRes.data || []) {
      const { data } = await supabase.storage
        .from("selfies")
        .createSignedUrl(folderPath + f.name, 300);
      if (data?.signedUrl) signedUrls.push(data.signedUrl);
    }

    res.json({ signedUrls, personId });
  } catch (err) {
    console.error("access-json error:", err);
    res.status(500).json({ error: err.message || "server error" });
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
