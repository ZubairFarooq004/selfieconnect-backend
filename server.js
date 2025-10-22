// server.js
// Selfie Connect Backend (Face++ + Supabase)
// Robust verify-upload with auto-refresh of expired Face++ tokens

import express from "express";
import path from "path";
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
const BUCKET_NAME = process.env.SUPABASE_BUCKET || "selfies";

console.log("✅ ENV CHECK:", {
  SUPABASE_URL: !!SUPABASE_URL,
  SUPABASE_KEY: !!SUPABASE_KEY,
  FACE_API_KEY: !!FACE_API_KEY,
  FACE_API_SECRET: !!FACE_API_SECRET,
  BACKEND_BASE_URL,
  CONFIDENCE_THRESHOLD,
  BUCKET_NAME,
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
const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------
// Static hosting for web view
// -----------------------------
app.use(express.static("public"));
app.get("/shared_view.html", (_req, res) => {
  // __dirname is not defined in ESM by default; compute safely
  const __dirnameSafe = path.dirname(new URL(import.meta.url).pathname);
  res.sendFile(path.join(__dirnameSafe, "public", "shared_view.html"));
});

// -----------------------------
// Face++ helpers
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
// Utility: download image buffer from signed URL
// -----------------------------
async function fetchImageBuffer(url) {
  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
  return Buffer.from(resp.data);
}

// -----------------------------
// Upload to Supabase using SDK (reliable)
// -----------------------------
async function uploadToSupabase(bucket, pathOnBucket, fileBuffer, contentType = "image/jpeg") {
  // supabase-js upload expects a File/Blob or Buffer in node environments
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(pathOnBucket, fileBuffer, { contentType, upsert: true });

  if (error) {
    console.error("❌ Supabase upload failed:", error.message || error);
    throw error;
  }
  return data;
}

// -----------------------------
// ROUTES
// -----------------------------
app.get("/", (_req, res) => res.json({ status: "ok", message: "Backend running 🚀" }));
app.get("/test", (_req, res) => res.send("✅ test ok"));

// -----------------------------
// CREATE PERSON
// -----------------------------
app.post("/create-person", upload.single("image"), async (req, res) => {
  try {
    const { userId, name } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!req.file?.buffer) return res.status(400).json({ error: "image required" });

    const detect = await faceppDetectFromBuffer(req.file.buffer);
    if (!detect?.faces?.length)
      return res.status(400).json({ created: false, reason: "no_face_detected" });

    const faceToken = detect.faces[0].face_token;

    const { data: person, error: pErr } = await supabase
      .from("persons")
      .insert([{ owner_user_id: userId, name: name || "person", face_token: faceToken }])
      .select()
      .single();
    if (pErr) throw pErr;

    const fileName = `${Date.now()}.jpg`;
    const pathOnBucket = `users/${userId}/${person.id}/${fileName}`;
    await uploadToSupabase(BUCKET_NAME, pathOnBucket, req.file.buffer, req.file.mimetype || "image/jpeg");

    await supabase
      .from("images")
      .insert([{ owner_user_id: userId, person_id: person.id, path: pathOnBucket }]);

    res.json({ created: true, personId: person.id, faceToken });
  } catch (err) {
    console.error("create-person error:", err?.response?.data || err.message || err);
    res.status(500).json({ error: err?.message || "server error", details: err?.response?.data || null });
  }
});

// -----------------------------
// VERIFY-UPLOAD (robust with token refresh)
// -----------------------------
app.post("/verify-upload", upload.single("image"), async (req, res) => {
  try {
    console.log("📩 VERIFY-UPLOAD triggered");
    console.log("🧾 Body:", req.body);
    console.log("📷 File present:", !!req.file);
    console.log("📷 File details:", req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : "No file");

    const { userId } = req.body;
    if (!userId) {
      console.error("❌ Missing userId in request body");
      return res.status(400).json({ error: "userId required" });
    }
    if (!req.file?.buffer) {
      console.error("❌ Missing image file in request");
      return res.status(400).json({ error: "image file required" });
    }

    // detect face on uploaded image
    const detect = await faceppDetectFromBuffer(req.file.buffer);
    if (!detect?.faces?.length) {
      console.error("❌ No face detected in upload");
      return res.status(400).json({ error: "no_face_detected_in_uploaded_image" });
    }
    const uploadedFaceToken = detect.faces[0].face_token;
    console.log("🧩 uploadedFaceToken:", uploadedFaceToken);

    // fetch persons for user
    const { data: persons, error: pErr } = await supabase
      .from("persons")
      .select("*")
      .eq("owner_user_id", userId);
    if (pErr) throw pErr;
    if (!persons?.length) return res.status(404).json({ error: "no_person_records_found" });

    console.log(`🧠 Found ${persons.length} persons for user ${userId}`);

    // iterate persons: try compare, if INVALID_FACE_TOKEN -> attempt refresh
    for (const p of persons) {
      try {
        console.log(`🔍 Comparing with person ${p.id} (${p.name || "Unnamed"})`);
        console.log("tokens:", { uploaded: uploadedFaceToken, stored: p.face_token });

        let cmp;
        try {
          cmp = await faceppCompare(uploadedFaceToken, p.face_token);
        } catch (compareErr) {
          // If invalid stored token, attempt refresh using stored image
          const errMsg = compareErr?.response?.data?.error_message || compareErr?.message || "";
          console.warn("⚠️ faceppCompare failed:", errMsg);

          if (errMsg && errMsg.includes("INVALID_FACE_TOKEN")) {
            console.log(`🔁 Stored token invalid for person ${p.id}, attempting refresh from storage`);

            // list files in folder
            const folderPath = `users/${userId}/${p.id}/`;
            const { data: listData, error: listErr } = await supabase.storage.from(BUCKET_NAME).list(folderPath, { limit: 50 });
            if (listErr) {
              console.warn("⚠️ Could not list folder for refresh:", listErr.message);
              continue; // skip this person
            }
            if (!listData || !listData.length) {
              console.warn(`⚠️ No stored images for person ${p.id} — deleting person row`);
              // optional: delete person row to keep DB clean
              await supabase.from("persons").delete().eq("id", p.id);
              continue;
            }

            // pick the latest image (last element) to regenerate token
            const fileObj = listData[listData.length - 1];
            const pathForSigned = folderPath + fileObj.name;
            const { data: signed, error: sErr } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(pathForSigned, 60);
            const signedUrl = signed?.signedUrl || signed?.signed_url || null;
            if (sErr || !signedUrl) {
              console.warn("⚠️ Could not create signed URL to refresh token:", sErr?.message || sErr);
              continue;
            }

            // download stored image bytes
            let buffer;
            try {
              buffer = await fetchImageBuffer(signedUrl);
            } catch (downloadErr) {
              console.warn("⚠️ Failed to download stored image for refresh:", downloadErr.message || downloadErr);
              continue;
            }

            // detect to get new token
            let detectNew;
            try {
              detectNew = await faceppDetectFromBuffer(buffer);
            } catch (dErr) {
              console.warn("⚠️ facepp detect on stored image failed:", dErr?.response?.data || dErr.message || dErr);
              continue;
            }
            if (!detectNew?.faces?.length) {
              console.warn("⚠️ No face detected when refreshing token for person", p.id);
              continue;
            }

            const newToken = detectNew.faces[0].face_token;
            console.log(`🔁 Updated face_token for person ${p.id} -> ${newToken}`);

            // update DB
            const { error: updErr } = await supabase.from("persons").update({ face_token: newToken }).eq("id", p.id);
            if (updErr) {
              console.warn("⚠️ Failed to update persons table with new token:", updErr.message);
              continue;
            }

            // retry compare with refreshed token
            cmp = await faceppCompare(uploadedFaceToken, newToken);
          } else {
            // other compare error — rethrow to outer try/catch for this person
            throw compareErr;
          }
        } // end inner compare try/catch

        // Log decision details for debugging threshold behavior
        if (cmp) {
          const decision = {
            confidence: cmp.confidence,
            threshold: CONFIDENCE_THRESHOLD,
            allow: cmp.confidence >= CONFIDENCE_THRESHOLD,
          };
          console.log("DECISION", decision);
        }

        // If comparison succeeded and confidence high enough → upload verification image and return gallery
        if (cmp && cmp.confidence >= CONFIDENCE_THRESHOLD) {
          console.log(`✅ Match found for person ${p.id} — confidence ${cmp.confidence}`);

          // upload verification image into the person's folder
          const verifiedName = `${Date.now()}_verified.jpg`;
          const verifiedPath = `users/${userId}/${p.id}/${verifiedName}`;
          try {
            await uploadToSupabase(BUCKET_NAME, verifiedPath, req.file.buffer, req.file.mimetype || "image/jpeg");
            // insert into images table
            await supabase.from("images").insert([{ owner_user_id: userId, person_id: p.id, path: verifiedPath }]);
          } catch (uErr) {
            console.warn("⚠️ Upload of verification image failed (continuing to return gallery if possible):", uErr?.message || uErr);
          }

          // list all images and produce signed URLs
          const folderPath = `users/${userId}/${p.id}/`;
          const { data: listRes, error: lrErr } = await supabase.storage.from(BUCKET_NAME).list(folderPath, { limit: 200 });
          if (lrErr) console.warn("⚠️ Could not list folder when building gallery:", lrErr.message);

          const signedUrls = [];
          for (const obj of listRes || []) {
            const path = folderPath + obj.name;
            const { data: signed2, error: s2Err } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(path, 120);
            const url = signed2?.signedUrl || signed2?.signed_url || null;
            if (s2Err) console.warn("⚠️ signed url error:", s2Err.message);
            if (url) signedUrls.push(url);
          }

          return res.json({
            match: true,
            personId: p.id,
            confidence: cmp.confidence,
            signedUrls,
          });
        } else {
          console.log(`ℹ️ Person ${p.id} not matched (confidence ${cmp?.confidence ?? "n/a"})`);
        }
      } catch (personErr) {
        console.error(`❌ Error while handling person ${p.id}:`, personErr?.response?.data || personErr.message || personErr);
        // continue to next person rather than abort entire endpoint
        continue;
      }
    } // end for persons

    // no match
    console.log("❌ No matching person found for uploaded image");
    return res.json({ match: false });
  } catch (err) {
    console.error("verify-upload error:", err?.response?.data || err.message || err);
    const details = err?.response?.data || null;
    return res.status(500).json({ error: err?.message || "server error", details });
  }
});

// -----------------------------
// QR & access routes (keep your previous behavior)
// -----------------------------
app.post("/generate-qr", async (req, res) => {
  try {
    const { userId, personId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    const { error } = await supabase.from("shared_links").insert([
      { owner_user_id: userId, person_id: personId || null, token, expires_at: expiresAt },
    ]);
    if (error) throw error;

    const baseUrl = BACKEND_BASE_URL;
    const qrLink = `${baseUrl}/shared_view.html?token=${token}`;
    res.json({ qrLink, token, expiresAt });
  } catch (err) {
    console.error("generate-qr error:", err);
    res.status(500).json({ error: err?.message || "server error" });
  }
});

// -----------------------------
// ACCESS ROUTE (for QR code access)
// -----------------------------
app.get("/access", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    // Verify token and get shared link data
    const { data: sharedLink, error } = await supabase
      .from("shared_links")
      .select("*")
      .eq("token", token)
      .gte("expires_at", new Date().toISOString())
      .single();

    if (error || !sharedLink) {
      return res.status(404).json({ error: "Invalid or expired token" });
    }

    // Get person data if personId is provided
    let personData = null;
    if (sharedLink.person_id) {
      const { data: person, error: pErr } = await supabase
        .from("persons")
        .select("*")
        .eq("id", sharedLink.person_id)
        .single();
      
      if (!pErr && person) {
        personData = person;
      }
    }

    // Get images for the person
    let images = [];
    if (sharedLink.person_id) {
      const { data: imageRecords, error: imgErr } = await supabase
        .from("images")
        .select("*")
        .eq("person_id", sharedLink.person_id);

      if (!imgErr && imageRecords?.length) {
        // Generate signed URLs for images
        for (const img of imageRecords) {
          const { data: signed, error: sErr } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(img.path, 300);
          
          if (!sErr && signed?.signedUrl) {
            images.push({
              id: img.id,
              url: signed.signedUrl,
              path: img.path
            });
          }
        }
      }
    }

    res.json({
      success: true,
      sharedLink: {
        id: sharedLink.id,
        owner_user_id: sharedLink.owner_user_id,
        person_id: sharedLink.person_id,
        expires_at: sharedLink.expires_at
      },
      person: personData,
      images
    });

  } catch (err) {
    console.error("access error:", err);
    res.status(500).json({ error: err?.message || "server error" });
  }
});

// -----------------------------
// ACCESS-JSON (for web view)
// -----------------------------
app.get("/access-json", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token required" });

    const { data: sharedLink, error } = await supabase
      .from("shared_links")
      .select("*")
      .eq("token", token)
      .gte("expires_at", new Date().toISOString())
      .single();

    if (error || !sharedLink) return res.status(404).json({ error: "Invalid or expired token" });

    // If person-specific, list images for that person folder in storage
    const urls = [];
    if (sharedLink.person_id) {
      const folderPath = `users/${sharedLink.owner_user_id}/${sharedLink.person_id}/`;
      const { data: listData, error: listErr } = await supabase.storage
        .from(BUCKET_NAME)
        .list(folderPath, { limit: 200 });
      if (!listErr && Array.isArray(listData)) {
        for (const obj of listData) {
          const pathOnBucket = folderPath + obj.name;
          const { data: signed, error: sErr } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(pathOnBucket, 300);
          const url = signed?.signedUrl || signed?.signed_url || null;
          if (!sErr && url) urls.push(url);
        }
      }
    }

    return res.json({ success: true, images: urls });
  } catch (err) {
    console.error("access-json error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
});

app.get("/debug-routes", (_req, res) =>
  res.json({
    backend: "Selfie Connect",
    routes: ["GET /test", "POST /create-person", "POST /verify-upload", "POST /generate-qr", "GET /access", "GET /access-json"],
  })
);

// -----------------------------
// Start Server
// -----------------------------
app.listen(PORT, () => console.log(`🚀 Selfie Connect backend running on port ${PORT}`));
