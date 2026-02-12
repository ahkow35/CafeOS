// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

Deno.serve(async (req) => {
  console.log("🚀 Function started");
  
  // 1. Check for the Key
  if (!RESEND_API_KEY) {
    console.error("❌ Missing RESEND_API_KEY");
    return new Response("Missing RESEND_API_KEY", { status: 500 });
  }
  console.log("✅ RESEND_API_KEY found");

  // 2. Parse the Webhook Data
  let body;
  try {
    body = await req.json();
    console.log("📦 Request body:", JSON.stringify(body));
  } catch (e) {
    console.error("❌ Failed to parse JSON:", e);
    return new Response("Invalid JSON", { status: 400 });
  }

  const { record, old_record } = body;

  // 3. Filter: Only send if status CHANGED to 'approved' or 'rejected'
  if (!record || !old_record) {
    console.log("⚠️ No record or old_record found");
    return new Response("No record data found", { status: 400 });
  }
  console.log("📋 Record status:", record.status, "| Old status:", old_record.status);
  
  if (record.status === old_record.status) {
    console.log("⏭️ Status unchanged, skipping");
    return new Response("Status did not change", { status: 200 });
  }
  if (!['approved', 'rejected'].includes(record.status)) {
    console.log("⏭️ Status not final:", record.status);
    return new Response("Status is not final", { status: 200 });
  }

  // 4. Fetch User Email (Using secure function that bypasses RLS)
  console.log("🔍 Fetching email for user:", record.user_id);
  const userRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_email_for_notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ user_uuid: record.user_id }),
  });
  
  const userData = await userRes.json();
  console.log("👤 User data response:", JSON.stringify(userData));
  
  const userEmail = userData?.[0]?.email;
  const userName = userData?.[0]?.full_name || "Staff Member";

  if (!userEmail) {
    console.error("❌ User email not found for ID:", record.user_id);
    return new Response("User email not found", { status: 400 });
  }
  console.log("✅ Found email:", userEmail, "| Name:", userName);

  // 5. Send via Resend
  console.log("📧 Sending email via Resend...");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Cafe Admin <onboarding@resend.dev>",
      to: [userEmail],
      subject: `Leave Request: ${record.status.toUpperCase()}`,
      html: `
        <h1>Hello ${userName},</h1>
        <p>Your leave request has been updated.</p>
        <h2>Status: <strong style="color: ${record.status === 'approved' ? 'green' : 'red'}">${record.status.toUpperCase()}</strong></h2>
        <p>Dates: ${new Date(record.start_date).toLocaleDateString()} - ${new Date(record.end_date).toLocaleDateString()}</p>
        <p>Login to the app to view details.</p>
      `,
    }),
  });

  const data = await res.json();
  console.log("📬 Resend response:", JSON.stringify(data));
  
  if (!res.ok) {
    console.error("❌ Resend error:", data);
    return new Response(JSON.stringify(data), { status: res.status });
  }
  
  console.log("✅ Email sent successfully!");
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

