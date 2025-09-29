// test-supabase.js
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// Get userId from command line argument
const userId = process.argv[2];
if (!userId) {
  console.error("❌ Please provide a userId. Example:");
  console.error("   node test-supabase.js 9233c357-84b5-441e-a8ec-aaa58feca8e2");
  process.exit(1);
}

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  console.log("🔎 Testing Supabase for userId:", userId);

  // List files in user's folder
  const { data, error } = await supabase.storage.from("selfies").list(userId);

  if (error) {
    console.error("❌ Error listing files:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("⚠️ No files found for this user.");
    process.exit(0);
  }

  console.log("📂 Files found:", data.map((f) => f.name));

  // Generate signed URLs
  for (let file of data) {
    const { data: signed, error: signedError } = await supabase.storage
      .from("selfies")
      .createSignedUrl(`${userId}/${file.name}`, 300);

    if (signedError) {
      console.error("❌ Error creating signed URL:", signedError.message);
    } else {
      console.log(`✅ Signed URL for ${file.name}:`, signed.signedUrl);
    }
  }
})();
