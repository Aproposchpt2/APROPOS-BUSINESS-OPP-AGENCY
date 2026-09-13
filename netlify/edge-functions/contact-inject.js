const seoHead = `
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<meta name="application-name" content="Apropos Business Opportunity Agency">
<meta property="og:site_name" content="Apropos Business Opportunity Agency">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Apropos Business Opportunity Agency | Procurement Intelligence">
<meta name="twitter:description" content="Creating business success through procurement intelligence, government contracting opportunities, and business opportunity development.">
<meta name="twitter:image" content="https://aproposopportunity.org/headquarters.webp">
<link rel="sitemap" type="application/xml" href="https://aproposopportunity.org/sitemap.xml">
<link rel="alternate" type="text/plain" href="https://aproposopportunity.org/llms.txt" title="AI-readable site summary">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://aproposopportunity.org/#organization",
      "name": "Apropos Business Opportunity Agency",
      "alternateName": "ABOA",
      "url": "https://aproposopportunity.org/",
      "description": "A nonprofit opportunity development organization creating business success through procurement intelligence and business opportunity development.",
      "slogan": "Creating Business Success Through Procurement Intelligence",
      "email": "jmitchell@aproposgroupllc.com",
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "general inquiries",
        "email": "jmitchell@aproposgroupllc.com",
        "url": "https://aproposopportunity.org/#contact"
      },
      "knowsAbout": [
        "Procurement intelligence",
        "Government contracting opportunities",
        "Business opportunity development",
        "Supplier opportunities",
        "Subcontracting opportunities",
        "Economic development",
        "Business growth"
      ]
    },
    {
      "@type": "WebSite",
      "@id": "https://aproposopportunity.org/#website",
      "url": "https://aproposopportunity.org/",
      "name": "Apropos Business Opportunity Agency",
      "alternateName": "ABOA",
      "publisher": {
        "@id": "https://aproposopportunity.org/#organization"
      },
      "inLanguage": "en-US"
    },
    {
      "@type": "WebPage",
      "@id": "https://aproposopportunity.org/#webpage",
      "url": "https://aproposopportunity.org/",
      "name": "Apropos Business Opportunity Agency | Procurement Intelligence",
      "description": "Apropos Business Opportunity Agency helps businesses identify, pursue, and participate in procurement and business opportunities that can contribute to growth.",
      "isPartOf": {
        "@id": "https://aproposopportunity.org/#website"
      },
      "about": {
        "@id": "https://aproposopportunity.org/#organization"
      },
      "inLanguage": "en-US"
    },
    {
      "@type": "Service",
      "@id": "https://aproposopportunity.org/#procurement-intelligence",
      "name": "Procurement Intelligence and Business Opportunity Development",
      "serviceType": "Procurement intelligence",
      "provider": {
        "@id": "https://aproposopportunity.org/#organization"
      },
      "url": "https://aproposopportunity.org/#marketplace",
      "description": "Procurement intelligence and opportunity-development support designed to help businesses discover and pursue relevant government contracting, supplier, subcontracting, and growth opportunities."
    }
  ]
}
</script>`;

const contactStyles = `
<style id="aboa-contact-styles">
  .contact-section{background:var(--navy-deep);color:#fff;padding:150px 0 155px;border-top:1px solid rgba(229,207,154,.18)}
  .contact-grid{display:grid;grid-template-columns:.78fr 1.22fr;gap:clamp(70px,9vw,140px);align-items:start}
  .contact-copy{position:sticky;top:130px}
  .contact-copy .section-title{max-width:520px;margin-bottom:28px}
  .contact-copy>p{max-width:520px;color:rgba(255,255,255,.66);font-size:1rem}
  .contact-note{margin-top:42px;padding-top:22px;border-top:1px solid rgba(229,207,154,.32);font-size:.72rem;line-height:1.8;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-light)}
  .inquiry-form{border-top:1px solid rgba(255,255,255,.18);padding-top:4px}
  .form-row{display:grid;grid-template-columns:1fr 1fr;gap:32px;border-bottom:1px solid rgba(255,255,255,.12);padding:24px 0}
  .form-row.single{grid-template-columns:1fr}
  .field label{display:block;margin-bottom:10px;font-size:.62rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--gold-light)}
  .field input,.field select,.field textarea{width:100%;border:0;border-bottom:1px solid rgba(255,255,255,.30);border-radius:0;background:transparent;color:#fff;font:inherit;font-size:.98rem;line-height:1.5;padding:7px 0 12px;outline:none;transition:border-color .2s ease}
  .field input:focus,.field select:focus,.field textarea:focus{border-color:var(--gold-light)}
  .field input::placeholder,.field textarea::placeholder{color:rgba(255,255,255,.36)}
  .field select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--gold-light) 50%),linear-gradient(135deg,var(--gold-light) 50%,transparent 50%);background-position:calc(100% - 14px) calc(50% - 2px),calc(100% - 9px) calc(50% - 2px);background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:30px}
  .field select option{background:#06162f;color:#fff}
  .field textarea{min-height:150px;resize:vertical}
  .optional{color:rgba(255,255,255,.44);font-weight:500;letter-spacing:.08em}
  .consent-row{display:flex;gap:14px;align-items:flex-start;padding:24px 0 6px}
  .consent-row input{margin-top:5px;accent-color:var(--gold)}
  .consent-row label{font-size:.76rem;line-height:1.7;color:rgba(255,255,255,.62)}
  .form-actions{display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin-top:28px}
  .inquiry-submit{border:1px solid var(--gold);background:var(--gold);color:var(--navy-deep);min-height:50px;padding:14px 24px;font:inherit;font-size:.66rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;cursor:pointer;transition:transform .2s ease,opacity .2s ease}
  .inquiry-submit:hover{transform:translateY(-2px)}
  .inquiry-submit:disabled{opacity:.55;cursor:wait;transform:none}
  .form-status{margin:0;min-height:24px;font-size:.82rem;color:var(--gold-light)}
  .form-status.error{color:#ffd0c8}
  .honeypot{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important}
  @media(max-width:900px){.contact-grid{grid-template-columns:1fr;gap:64px}.contact-copy{position:static}}
  @media(max-width:640px){.contact-section{padding:105px 0 110px}.form-row{grid-template-columns:1fr;gap:22px;padding:22px 0}.form-actions{align-items:flex-start;flex-direction:column}.inquiry-submit{width:100%}}
</style>`;

const contactSection = `
<section class="contact-section" id="contact" aria-labelledby="contact-title">
  <div class="shell contact-grid">
    <div class="contact-copy reveal">
      <div class="eyebrow">Contact the Agency</div>
      <h2 class="section-title" id="contact-title">Start an inquiry.</h2>
      <p>Whether you are a business seeking procurement intelligence, an organization exploring partnership, or a supporter interested in advancing business opportunity, we welcome the conversation.</p>
      <p class="contact-note">Your inquiry is sent directly to the Agency for review.</p>
    </div>

    <form class="inquiry-form reveal" id="inquiryForm" novalidate>
      <div class="honeypot" aria-hidden="true">
        <label for="website">Website</label>
        <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>

      <div class="form-row">
        <div class="field">
          <label for="inq-name">Name *</label>
          <input id="inq-name" name="name" type="text" autocomplete="name" maxlength="120" required>
        </div>
        <div class="field">
          <label for="inq-organization">Business / Organization Name</label>
          <input id="inq-organization" name="organization" type="text" autocomplete="organization" maxlength="160">
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label for="inq-email">Email *</label>
          <input id="inq-email" name="email" type="email" autocomplete="email" maxlength="180" required>
        </div>
        <div class="field">
          <label for="inq-phone">Phone <span class="optional">Optional</span></label>
          <input id="inq-phone" name="phone" type="tel" autocomplete="tel" maxlength="80">
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label for="inq-state">State *</label>
          <input id="inq-state" name="state" type="text" autocomplete="address-level1" maxlength="80" placeholder="e.g., Nevada" required>
        </div>
        <div class="field">
          <label for="inq-type">Inquiry Type *</label>
          <select id="inq-type" name="inquiryType" required>
            <option value="">Select inquiry type</option>
            <option>Business Opportunity</option>
            <option>Procurement Intelligence</option>
            <option>Partnership</option>
            <option>Funding or Sponsorship</option>
            <option>General Inquiry</option>
          </select>
        </div>
      </div>

      <div class="form-row single">
        <div class="field">
          <label for="inq-message">Message *</label>
          <textarea id="inq-message" name="message" maxlength="5000" placeholder="Tell us how the Agency can assist or collaborate with you." required></textarea>
        </div>
      </div>

      <div class="consent-row">
        <input id="inq-consent" name="consent" type="checkbox" required>
        <label for="inq-consent">I agree to be contacted by APROPOS BUSINESS OPPORTUNITY AGENCY regarding this inquiry.</label>
      </div>

      <div class="form-actions">
        <button class="inquiry-submit" id="inquirySubmit" type="submit">Send Inquiry</button>
        <p class="form-status" id="inquiryStatus" role="status" aria-live="polite"></p>
      </div>
    </form>
  </div>
</section>`;

const contactScript = `
<script id="aboa-contact-script">
(() => {
  const form = document.getElementById('inquiryForm');
  if (!form) return;
  const button = document.getElementById('inquirySubmit');
  const status = document.getElementById('inquiryStatus');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'form-status';
    status.textContent = '';

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    data.consent = document.getElementById('inq-consent').checked;
    button.disabled = true;
    button.textContent = 'Sending…';

    try {
      const response = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || 'We could not send your inquiry right now.');
      status.textContent = result.message || 'Thank you. Your inquiry has been sent to the Agency.';
      form.reset();
    } catch (error) {
      status.className = 'form-status error';
      status.textContent = error.message || 'We could not send your inquiry right now. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Send Inquiry';
    }
  });
})();
</script>`;

export default async (request, context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (html.includes('id="inquiryForm"')) return new Response(html, response);

  html = html.replace("</head>", `${seoHead}\n${contactStyles}\n</head>`);
  html = html.replace(
    '<a href="#partnerships" class="nav-accent">Partnerships</a>',
    '<a href="#partnerships">Partnerships</a><a href="#contact" class="nav-accent">Contact</a>'
  );
  html = html.replace(
    '<a href="#partnerships">Partnerships</a>\n        </nav>',
    '<a href="#partnerships">Partnerships</a>\n          <a href="#contact">Contact</a>\n        </nav>'
  );
  html = html.replace("</main>", `${contactSection}\n</main>`);
  html = html.replace("</body>", `${contactScript}\n</body>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.set("cache-control", "public, max-age=0, must-revalidate");

  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
