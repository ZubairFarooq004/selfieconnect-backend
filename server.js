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
// const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

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

// // 🌍 Health
// app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// // 🎫 Generate QR
// app.post("/generate-qr", async (req, res) => {
//   try {
//     const { userId, singleUse = false } = req.body;
//     if (!userId) return res.status(400).json({ error: "userId required" });

//     const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });

//     if (singleUse) {
//       await supabase.from("qr_tokens").insert([{ token, user_id: userId, used: false }]);
//     }

//     const encoded = encodeURIComponent(token);

//     // ✅ use PUBLIC_URL instead of localhost
//     const link = `${PUBLIC_URL}/view?token=${encoded}`;
//     const apiAccess = `${PUBLIC_URL}/access-json?token=${encoded}`;

//     res.json({ qrLink: link, apiAccess, token, expiresIn: "1h" });
//   } catch (e) {
//     console.error("/generate-qr error:", e);
//     res.status(500).json({ error: e.message || e });
//   }
// });

// // 📂 JSON API
// app.get("/access-json", async (req, res) => {
//   try {
//     const token = req.query.token || req.headers["authorization"]?.split(" ")[1];
//     if (!token) return res.status(400).json({ error: "token required" });

//     // verify JWT
//     let decoded;
//     try {
//       decoded = jwt.verify(token, JWT_SECRET);
//     } catch (err) {
//       console.error("JWT verify failed:", err.message);
//       return res.status(401).json({ error: "Invalid or expired token" });
//     }
//     const userId = decoded.userId;

//     const { data: files, error } = await supabase.storage.from("selfies").list(userId);
//     if (error) return res.status(500).json({ error: error.message });
//     if (!files || files.length === 0) return res.json({ userId, files: [] });

//     const signed = await Promise.all(
//       files.map(async (f) => {
//         const { data, error: se } = await supabase.storage
//           .from("selfies")
//           .createSignedUrl(`${userId}/${f.name}`, 300);
//         if (se) return null;
//         const url = data?.signedUrl ?? data?.signed_url ?? null;
//         return { name: f.name, url };
//       })
//     );

//     res.json({ userId, files: signed.filter(Boolean) });
//   } catch (e) {
//     console.error("/access-json error:", e);
//     res.status(500).json({ error: e.message || e });
//   }
// });

// // 🌐 Friendly HTML view
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

// app.listen(PORT, () => console.log(`🚀 Server running on ${PUBLIC_URL}`));

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
const PUBLIC_URL =
  process.env.PUBLIC_URL || `http://localhost:${PORT}`;

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

/* -----------------------------
   🌍 Health Endpoints
------------------------------ */
app.get("/", (req, res) =>
  res.json({ status: "ok", message: "Backend root alive 🚀" })
);
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", message: "Backend running 🚀" })
);

/* -----------------------------
   🎫 Generate QR
------------------------------ */
app.post("/generate-qr", async (req, res) => {
  try {
    const { userId, singleUse = false } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });

    if (singleUse) {
      await supabase.from("qr_tokens").insert([
        { token, user_id: userId, used: false },
      ]);
    }

    const encoded = encodeURIComponent(token);

    // Always use Render's PUBLIC_URL if provided
    const link = `${PUBLIC_URL}/view?token=${encoded}`;
    const apiAccess = `${PUBLIC_URL}/access-json?token=${encoded}`;

    res.json({ qrLink: link, apiAccess, token, expiresIn: "1h" });
  } catch (e) {
    console.error("/generate-qr error:", e);
    res.status(500).json({ error: e.message || e });
  }
});

/* -----------------------------
   📂 JSON API
------------------------------ */
app.get("/access-json", async (req, res) => {
  try {
    const token =
      req.query.token ||
      req.headers["authorization"]?.split(" ")[1];
    if (!token) return res.status(400).json({ error: "token required" });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error("JWT verify failed:", err.message);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const userId = decoded.userId;

    const { data: files, error } = await supabase.storage
      .from("selfies")
      .list(userId);
    if (error) return res.status(500).json({ error: error.message });
    if (!files || files.length === 0)
      return res.json({ userId, files: [] });

    const signed = await Promise.all(
      files.map(async (f) => {
        const { data, error: se } = await supabase.storage
          .from("selfies")
          .createSignedUrl(`${userId}/${f.name}`, 300);
        if (se) return null;
        const url =
          data?.signedUrl ?? data?.signed_url ?? null;
        return { name: f.name, url };
      })
    );

    res.json({ userId, files: signed.filter(Boolean) });
  } catch (e) {
    console.error("/access-json error:", e);
    res.status(500).json({ error: e.message || e });
  }
});

/* -----------------------------
   🌐 Friendly HTML view
------------------------------ */
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

    const { data: files } = await supabase.storage
      .from("selfies")
      .list(userId);
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
      .map(
        (s) =>
          `<div style="margin:8px"><img src="${escapeHtml(
            s.url
          )}" style="max-width:100%;height:auto"/></div>`
      )
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

/* -----------------------------
   🚀 Start server
------------------------------ */
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PUBLIC_URL}`)
);
