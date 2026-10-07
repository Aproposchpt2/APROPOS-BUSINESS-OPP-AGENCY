const CEOC_DEFAULT_URL = "https://vqrqyanqsiqzsmlhytaz.supabase.co";

const clean = (v, n = 5000) => String(v ?? "").trim().slice(0, n);

async function ceocRequest(path, options = {}) {
  const base = (Netlify.env.get("CEOC_SUPABASE_URL") || CEOC_DEFAULT_URL).replace(/\/$/, "");
  const key = Netlify.env.get("CEOC_SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return { skipped: true };

  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`CEOC ${res.status}: ${data?.message || text || "request failed"}`);
  return data;
}

async function captureInCeoc({ name, organization, email, phone, state, inquiryType, message, consent, receivedAt }) {
  if (!Netlify.env.get("CEOC_SUPABASE_SERVICE_ROLE_KEY")) return { skipped: true };

  const tenantRows = await ceocRequest(
    "tenants?tenant_slug=eq.apropos&select=id&limit=1"
  );
  const tenantId = tenantRows?.[0]?.id;
  if (!tenantId) throw new Error("CEOC Apropos tenant was not found.");

  let contactId = null;
  const existing = await ceocRequest(
    `ai4cc_contacts?tenant_id=eq.${encodeURIComponent(tenantId)}&email=eq.${encodeURIComponent(email)}&select=id&limit=1`
  );

  if (existing?.[0]?.id) {
    contactId = existing[0].id;
  } else {
    const contactRows = await ceocRequest("ai4cc_contacts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        tenant_id: tenantId,
        display_name: name,
        company_name: organization || null,
        email,
        phone: phone || null,
        preferred_channel: "email",
        lead_source: "BODA Website",
        tags: ["boda", "website_inquiry"],
        metadata: {
          source: "boda_web_contact_form",
          state,
          inquiry_type: inquiryType,
          contact_consent: consent,
          first_seen_at: receivedAt
        }
      })
    });
    contactId = contactRows?.[0]?.id;
  }

  if (!contactId) throw new Error("CEOC contact could not be created or resolved.");

  const interactionRows = await ceocRequest("ai4cc_interactions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      tenant_id: tenantId,
      channel: "email",
      direction: "inbound",
      external_id: `boda-form-${crypto.randomUUID()}`,
      customer_identifier: email,
      status: "completed",
      started_at: receivedAt,
      ended_at: receivedAt,
      metadata: {
        source: "boda_web_contact_form",
        inquiry_type: inquiryType,
        business_name: organization || null,
        state,
        phone: phone || null,
        message,
        contact_consent: consent
      }
    })
  });
  const interactionId = interactionRows?.[0]?.id || null;

  const leadRows = await ceocRequest("ai4cc_leads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      tenant_id: tenantId,
      contact_id: contactId,
      originating_interaction_id: interactionId,
      originating_channel: "email",
      title: `BODA: ${inquiryType} — ${organization || name}`.slice(0, 240),
      service_interest: inquiryType,
      description: message,
      pipeline_stage: "new",
      status: "open",
      priority: "normal",
      next_action: "Review BODA inquiry and contact prospect",
      metadata: {
        source: "boda_web_contact_form",
        business_name: organization || null,
        state,
        phone: phone || null,
        submitted_at: receivedAt,
        contact_consent: consent
      }
    })
  });

  return {
    ok: true,
    contact_id: contactId,
    interaction_id: interactionId,
    lead_id: leadRows?.[0]?.id || null
  };
}

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, message: "Method not allowed." }), { status: 405, headers: { "content-type": "application/json" } });
  }

  let data;
  try { data = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, message: "Invalid request." }), { status: 400, headers: { "content-type": "application/json" } }); }

  if (clean(data.website, 200)) return Response.json({ ok: true, message: "Thank you. Your inquiry has been received." });

  const name = clean(data.name, 120);
  const organization = clean(data.organization, 160);
  const email = clean(data.email, 180).toLowerCase();
  const phone = clean(data.phone, 80);
  const state = clean(data.state, 80);
  const inquiryType = clean(data.inquiryType, 80);
  const message = clean(data.message, 5000);
  const consent = data.consent === true;
  const validTypes = ["Business Opportunity", "Procurement Intelligence", "Contract Preparedness", "Business Development Roadmap", "Business Development Marketing Engine", "Partnership", "Funding or Sponsorship", "General Inquiry"];
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || !email || !state || !message || !consent || !validEmail || !validTypes.includes(inquiryType)) {
    return Response.json({ ok: false, message: "Please complete all required fields correctly." }, { status: 400 });
  }

  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("RESEND_FROM_EMAIL");
  const to = Netlify.env.get("RESEND_TO_EMAIL");
  const resendConfigured = Boolean(apiKey && from && to);
  const ceocConfigured = Boolean(Netlify.env.get("CEOC_SUPABASE_SERVICE_ROLE_KEY"));

  if (!resendConfigured && !ceocConfigured) {
    return Response.json({ ok: false, message: "Inquiry service is temporarily unavailable." }, { status: 503 });
  }

  const safe = (v) => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const receivedAt = new Date().toISOString();
  const subject = `[BODA Inquiry] ${inquiryType} — ${(organization || name).replace(/[\r\n]+/g, " ").slice(0, 120)}`;
  const text = `BUSINESS OPPORTUNITY DEVELOPMENT AGENCY\nNEW WEBSITE INQUIRY\n\nInquiry Type: ${inquiryType}\nName: ${name}\nBusiness / Organization: ${organization || "Not provided"}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nState: ${state}\nReceived: ${receivedAt}\n\nMessage:\n${message}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#101b2c"><h2 style="color:#06162f">BUSINESS OPPORTUNITY DEVELOPMENT AGENCY — New Inquiry</h2><p><strong>Inquiry Type:</strong> ${safe(inquiryType)}</p><p><strong>Name:</strong> ${safe(name)}</p><p><strong>Business / Organization:</strong> ${safe(organization || "Not provided")}</p><p><strong>Email:</strong> ${safe(email)}</p><p><strong>Phone:</strong> ${safe(phone || "Not provided")}</p><p><strong>State:</strong> ${safe(state)}</p><hr><p>${safe(message).replace(/\n/g,"<br>")}</p><hr><small>Received ${safe(receivedAt)}. Visitor consented to be contacted regarding this inquiry.</small></div>`;

  const payload = { name, organization, email, phone, state, inquiryType, message, consent, receivedAt };

  const resendPromise = resendConfigured
    ? fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], reply_to: email, subject, text, html })
      }).then(async (res) => {
        if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
        return { ok: true };
      })
    : Promise.resolve({ skipped: true });

  const ceocPromise = ceocConfigured
    ? captureInCeoc(payload)
    : Promise.resolve({ skipped: true });

  const [resendResult, ceocResult] = await Promise.allSettled([resendPromise, ceocPromise]);

  const resendOk = resendResult.status === "fulfilled" && !resendResult.value?.skipped;
  const ceocOk = ceocResult.status === "fulfilled" && !ceocResult.value?.skipped;

  if (resendResult.status === "rejected") console.error("Resend failed:", resendResult.reason);
  if (ceocResult.status === "rejected") console.error("CEOC capture failed:", ceocResult.reason);

  if (!resendOk && !ceocOk) {
    return Response.json({ ok: false, message: "We could not submit your inquiry right now. Please try again." }, { status: 502 });
  }

  return Response.json({ ok: true, message: "Thank you. Your inquiry has been sent to the Agency." });
};

export const config = { path: "/api/inquiry" };
