export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, message: "Method not allowed." }), { status: 405, headers: { "content-type": "application/json" } });
  }

  let data;
  try { data = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, message: "Invalid request." }), { status: 400, headers: { "content-type": "application/json" } }); }

  const clean = (v, n = 5000) => String(v ?? "").trim().slice(0, n);
  if (clean(data.website, 200)) return Response.json({ ok: true, message: "Thank you. Your inquiry has been received." });

  const name = clean(data.name, 120);
  const organization = clean(data.organization, 160);
  const email = clean(data.email, 180).toLowerCase();
  const phone = clean(data.phone, 80);
  const state = clean(data.state, 80);
  const inquiryType = clean(data.inquiryType, 80);
  const message = clean(data.message, 5000);
  const consent = data.consent === true;
  const validTypes = ["Business Opportunity", "Procurement Intelligence", "Contract Preparedness", "Partnership", "Funding or Sponsorship", "General Inquiry"];
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || !email || !state || !message || !consent || !validEmail || !validTypes.includes(inquiryType)) {
    return Response.json({ ok: false, message: "Please complete all required fields correctly." }, { status: 400 });
  }

  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("RESEND_FROM_EMAIL");
  const to = Netlify.env.get("RESEND_TO_EMAIL");
  if (!apiKey || !from || !to) return Response.json({ ok: false, message: "Inquiry service is temporarily unavailable." }, { status: 503 });

  const safe = (v) => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const receivedAt = new Date().toISOString();
  const subject = `[ABOA Inquiry] ${inquiryType} — ${(organization || name).replace(/[\r\n]+/g, " ").slice(0, 120)}`;
  const text = `APROPOS BUSINESS OPPORTUNITY AGENCY\nNEW WEBSITE INQUIRY\n\nInquiry Type: ${inquiryType}\nName: ${name}\nBusiness / Organization: ${organization || "Not provided"}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nState: ${state}\nReceived: ${receivedAt}\n\nMessage:\n${message}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#101b2c"><h2 style="color:#06162f">Apropos Business Opportunity Agency — New Inquiry</h2><p><strong>Inquiry Type:</strong> ${safe(inquiryType)}</p><p><strong>Name:</strong> ${safe(name)}</p><p><strong>Business / Organization:</strong> ${safe(organization || "Not provided")}</p><p><strong>Email:</strong> ${safe(email)}</p><p><strong>Phone:</strong> ${safe(phone || "Not provided")}</p><p><strong>State:</strong> ${safe(state)}</p><hr><p>${safe(message).replace(/\n/g,"<br>")}</p><hr><small>Received ${safe(receivedAt)}. Visitor consented to be contacted regarding this inquiry.</small></div>`;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], reply_to: email, subject, text, html })
  });

  if (!sent.ok) {
    console.error("Resend failed", sent.status, await sent.text());
    return Response.json({ ok: false, message: "We could not send your inquiry right now. Please try again." }, { status: 502 });
  }

  return Response.json({ ok: true, message: "Thank you. Your inquiry has been sent to the Agency." });
};

export const config = { path: "/api/inquiry" };
