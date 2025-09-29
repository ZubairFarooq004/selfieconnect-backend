// // server.js
// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const bodyParser = require("body-parser");
// const jwt = require("jsonwebtoken");
// const { createClient } = require("@supabase/supabase-js");
// const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// // env
// const PORT = process.env.PORT || 5000;
// const SUPABASE_URL = process.env.SUPABASE_URL;
// const SUPABASE_KEY = process.env.SUPABASE_KEY; // MUST be service_role
// const JWT_SECRET = process.env.JWT_SECRET || "change_this";

// if (!SUPABASE_URL || !SUPABASE_KEY) {
//   console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
//   process.exit(1);
// }

// console.log("✅ SUPABASE_URL:", SUPABASE_URL);
// console.log("✅ JWT_SECRET in use (first 6 chars):", JWT_SECRET.slice(0,6));

// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// const app = express();
// app.use(cors());
// app.use(bodyParser.json());

// // health
// app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// // Generate QR (authenticated user should call this)
// app.post("/generate-qr", async (req, res) => {
//   try {
//     const { userId, singleUse = false } = req.body;
//     if (!userId) return res.status(400).json({ error: "userId required" });

//     // Create JWT (1 hour). You can shorten if needed:
//     const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });

//     // store token in DB for single use (optional) - requires table qr_tokens
//     if (singleUse) {
//       await supabase.from("qr_tokens").insert([
//         { token, user_id: userId, used: false }
//       ]);
//     }

//     // encode token for safe URL
//     const encoded = encodeURIComponent(token);

//     // If you test from phone, replace 'localhost' with your machine IP or a public ngrok URL
//     const host = req.headers.host || `localhost:${PORT}`;
//     const link = `http://${host}/view?token=${encoded}`; // opens a friendly HTML page
//     const apiAccess = `http://${host}/access-json?token=${encoded}`; // returns JSON only

//     res.json({ qrLink: link, apiAccess, token, expiresIn: "1h" });
//   } catch (e) {
//     console.error("/generate-qr error:", e);
//     res.status(500).json({ error: e.message || e });
//   }
// });

// // JSON endpoint (for app): verify token and return signed URLs
// app.get("/access-json", async (req, res) => {
//   try {
//     const token = req.query.token || req.headers["authorization"]?.split(" ")[1];
//     if (!token) return res.status(400).json({ error: "token required" });

//     // optional: check DB single-use
//     if (process.env.ENFORCE_SINGLE_USE === "true") {
//       const { data: rows, error: qerr } = await supabase
//         .from("qr_tokens")
//         .select("*")
//         .eq("token", token)
//         .limit(1);
//       if (qerr) console.error("qr_tokens query error:", qerr);
//       const row = rows?.[0];
//       if (!row) return res.status(401).json({ error: "token not found" });
//       if (row.used) return res.status(401).json({ error: "token already used" });
//     }

//     // verify JWT
//     let decoded;
//     try {
//       decoded = jwt.verify(token, JWT_SECRET);
//     } catch (err) {
//       console.error("JWT verify failed:", err.message);
//       return res.status(401).json({ error: "Invalid or expired token" });
//     }
//     const userId = decoded.userId;

//     // list files
//     const { data: files, error } = await supabase.storage.from("selfies").list(userId);
//     if (error) {
//       console.error("Supabase list error:", error);
//       return res.status(500).json({ error: error.message || error });
//     }
//     if (!files || files.length === 0) return res.json({ userId, files: [] });

//     // create signed urls (short expiry)
//     const signed = await Promise.all(
//       files.map(async (f) => {
//         const path = `${userId}/${f.name}`;
//         const { data, error: se } = await supabase.storage.from("selfies").createSignedUrl(path, 300);
//         if (se) {
//           console.error("createSignedUrl error for", path, se);
//           return null;
//         }
//         // accommodate different SDK shapes
//         const url = data?.signedUrl ?? data?.signed_url ?? data?.publicUrl ?? null;
//         return { name: f.name, url };
//       })
//     );

//     // mark token used (single-use)
//     if (process.env.ENFORCE_SINGLE_USE === "true") {
//       await supabase.from("qr_tokens").update({ used: true }).eq("token", token);
//     }

//     res.json({ userId, files: signed.filter(Boolean) });
//   } catch (e) {
//     console.error("/access-json error:", e);
//     res.status(500).json({ error: e.message || e });
//   }
// });

// // Friendly HTML view for scanners (mobile browser)
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

//     const { data: files } = await supabase.storage.from("selfies").list(userId);
//     if (!files || files.length === 0) {
//       return res.send(`<h3>No images found for user ${escapeHtml(userId)}</h3>`);
//     }
//     // get signed urls
//     const signed = await Promise.all(
//       files.map(async (f) => {
//         const { data } = await supabase.storage.from("selfies").createSignedUrl(`${userId}/${f.name}`, 300);
//         const url = data?.signedUrl ?? data?.publicUrl ?? null;
//         return { name: f.name, url };
//       })
//     );

//     // simple HTML
//     const imgs = signed
//       .filter((s) => s && s.url)
//       .map((s) => `<div style="margin:8px"><img src="${escapeHtml(s.url)}" style="max-width:100%;height:auto"/></div>`)
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

// app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

// HTML escaping helper
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

// 🔑 Environment
const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // must be service_role
const JWT_SECRET = process.env.JWT_SECRET || "change_this";
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
  process.exit(1);
}

console.log("✅ SUPABASE_URL:", SUPABASE_URL);
console.log("✅ JWT_SECRET (first 6 chars):", JWT_SECRET.slice(0, 6));
console.log("🌍 PUBLIC_URL:", PUBLIC_URL);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🌍 Health
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// 🎫 Generate QR
app.post("/generate-qr", async (req, res) => {
  try {
    const { userId, singleUse = false } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });

    if (singleUse) {
      await supabase.from("qr_tokens").insert([{ token, user_id: userId, used: false }]);
    }

    const encoded = encodeURIComponent(token);

    // ✅ use PUBLIC_URL instead of localhost
    const link = `${PUBLIC_URL}/view?token=${encoded}`;
    const apiAccess = `${PUBLIC_URL}/access-json?token=${encoded}`;

    res.json({ qrLink: link, apiAccess, token, expiresIn: "1h" });
  } catch (e) {
    console.error("/generate-qr error:", e);
    res.status(500).json({ error: e.message || e });
  }
});

// 📂 JSON API
app.get("/access-json", async (req, res) => {
  try {
    const token = req.query.token || req.headers["authorization"]?.split(" ")[1];
    if (!token) return res.status(400).json({ error: "token required" });

    // verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error("JWT verify failed:", err.message);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const userId = decoded.userId;

    const { data: files, error } = await supabase.storage.from("selfies").list(userId);
    if (error) return res.status(500).json({ error: error.message });
    if (!files || files.length === 0) return res.json({ userId, files: [] });

    const signed = await Promise.all(
      files.map(async (f) => {
        const { data, error: se } = await supabase.storage
          .from("selfies")
          .createSignedUrl(`${userId}/${f.name}`, 300);
        if (se) return null;
        const url = data?.signedUrl ?? data?.signed_url ?? null;
        return { name: f.name, url };
      })
    );

    res.json({ userId, files: signed.filter(Boolean) });
  } catch (e) {
    console.error("/access-json error:", e);
    res.status(500).json({ error: e.message || e });
  }
});

// 🌐 Friendly HTML view
app.get("/view", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("token required");

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).send("Invalid or expired token");
    }
    const userId = decoded.userId;

    const { data: files } = await supabase.storage.from("selfies").list(userId);
    if (!files || files.length === 0) {
      return res.send(`<h3>No images found for user ${escapeHtml(userId)}</h3>`);
    }

    const signed = await Promise.all(
      files.map(async (f) => {
        const { data } = await supabase.storage
          .from("selfies")
          .createSignedUrl(`${userId}/${f.name}`, 300);
        return { name: f.name, url: data?.signedUrl ?? null };
      })
    );

    const imgs = signed
      .filter((s) => s && s.url)
      .map((s) => `<div style="margin:8px"><img src="${escapeHtml(s.url)}" style="max-width:100%;height:auto"/></div>`)
      .join("\n");

    return res.send(`
      <html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>Images for ${escapeHtml(userId)}</title></head>
      <body>
        <h3>Images for ${escapeHtml(userId)}</h3>
        ${imgs}
      </body></html>
    `);
  } catch (e) {
    console.error("/view error:", e);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on ${PUBLIC_URL}`));
