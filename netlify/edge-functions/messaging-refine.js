function refineMessaging(html) {
  const replacements = [
    [
      '<title>Apropos Business Opportunity Agency | Procurement Intelligence</title>',
      '<title>Apropos Business Opportunity Agency | Economic Opportunity Development</title>'
    ],
    [
      '<meta name="description" content="Apropos Business Opportunity Agency is a business-opportunity and contract-opportunity service platform expanding economic opportunity for businesses and communities." />',
      '<meta name="description" content="Apropos Business Opportunity Agency is a business-opportunity and contract-opportunity service platform building economic, business, and community growth through opportunity." />'
    ],
    [
      '<meta property="og:description" content="Creating business success through procurement intelligence." />',
      '<meta property="og:description" content="Building economic, business and community growth through opportunity." />'
    ],
    [
      '<meta name="twitter:title" content="Apropos Business Opportunity Agency | Procurement Intelligence">',
      '<meta name="twitter:title" content="Apropos Business Opportunity Agency | Economic Opportunity Development">'
    ],
    [
      '<meta name="twitter:description" content="Creating business success through procurement intelligence, government contracting opportunities, and business opportunity development.">',
      '<meta name="twitter:description" content="Building economic, business and community growth by expanding pathways to opportunity for businesses and the communities they serve.">'
    ],
    [
      '"description": "A business-opportunity and contract-opportunity service platform expanding economic opportunity through procurement intelligence and business development."',
      '"description": "A business-opportunity and contract-opportunity service platform building economic, business, and community growth by expanding pathways to opportunity."'
    ],
    [
      '"slogan": "Creating Business Success Through Procurement Intelligence"',
      '"slogan": "Building Economic, Business & Community Growth Through Opportunity"'
    ],
    [
      '"knowsAbout": [\n        "Procurement intelligence",\n        "Government contracting opportunities",\n        "Business opportunity development",\n        "Supplier opportunities",\n        "Subcontracting opportunities",\n        "Economic development",\n        "Business growth"\n      ]',
      '"knowsAbout": [\n        "Economic opportunity development",\n        "Business growth",\n        "Community economic development",\n        "Government contracting opportunities",\n        "Procurement intelligence",\n        "Supplier and subcontracting opportunities",\n        "Buyer connections",\n        "Capital and funding resources",\n        "Technical assistance",\n        "Strategic partnerships",\n        "Market expansion",\n        "Entrepreneurship resources"\n      ]'
    ],
    [
      '"name": "Apropos Business Opportunity Agency | Procurement Intelligence"',
      '"name": "Apropos Business Opportunity Agency | Economic Opportunity Development"'
    ],
    [
      '"description": "Apropos Business Opportunity Agency helps businesses identify, pursue, and participate in procurement and business opportunities that can contribute to growth."',
      '"description": "Apropos Business Opportunity Agency expands pathways to economic opportunity so businesses can grow, participate, employ people, engage suppliers, and strengthen communities."'
    ],
    [
      '"@id": "https://aproposopportunity.org/#procurement-intelligence"',
      '"@id": "https://aproposopportunity.org/#opportunity-development"'
    ],
    [
      '"name": "Procurement Intelligence and Business Opportunity Development"',
      '"name": "Economic Opportunity and Business Development"'
    ],
    [
      '"serviceType": "Procurement intelligence"',
      '"serviceType": "Opportunity development"'
    ],
    [
      '"url": "https://aproposopportunity.org/#marketplace",\n      "description": "Procurement intelligence and opportunity-development support designed to help businesses discover and pursue relevant government contracting, supplier, subcontracting, and growth opportunities."',
      '"url": "https://aproposopportunity.org/#development",\n      "description": "Opportunity-development support connecting businesses with government contracting, buyers, suppliers, capital, resources, partnerships, market-expansion pathways, and other opportunities that can contribute to economic growth."'
    ],
    [
      '<div class="hero-positioning" aria-label="Creating business success through procurement intelligence">',
      '<div class="hero-positioning" aria-label="Building economic, business and community growth through opportunity">'
    ],
    [
      '<span>Creating Business Success</span>',
      '<span>Building Economic, Business &amp; Community Growth</span>'
    ],
    [
      '<strong>Through Procurement Intelligence</strong>',
      '<strong>Through Opportunity</strong>'
    ],
    [
      '<p class="hero-intro">APROPOS BUSINESS OPPORTUNITY AGENCY is dedicated to expanding economic opportunity by helping businesses identify, pursue, and participate in opportunities that can contribute to their growth.</p>',
      '<p class="hero-intro">APROPOS BUSINESS OPPORTUNITY AGENCY is dedicated to expanding economic opportunity by helping businesses identify, pursue, and participate in opportunities that can contribute to their growth and strengthen the communities they serve.</p>'
    ],
    [
      '<div class="model-step reveal"><div class="num">01</div><div><h3>Opportunity</h3><p>Creates pathways for business growth.</p></div></div>',
      '<div class="model-step reveal"><div class="num">01</div><div><h3>Opportunity</h3><p>Creates pathways for businesses to participate, compete, and grow.</p></div></div>'
    ],
    [
      '<div class="model-step reveal"><div class="num">02</div><div><h3>Business Growth</h3><p>Creates greater potential for revenue, investment, supplier activity, and employment.</p></div></div>',
      '<div class="model-step reveal"><div class="num">02</div><div><h3>Business Growth</h3><p>Can create revenue, expansion, employment, investment, and supplier activity.</p></div></div>'
    ],
    [
      '<div class="model-step reveal"><div class="num">03</div><div><h3>Economic Participation</h3><p>Employment and participation contribute to household stability, career advancement, and local spending.</p></div></div>',
      '<div class="model-step reveal"><div class="num">03</div><div><h3>Economic Participation</h3><p>Greater participation can strengthen families through employment, household stability, career advancement, and local spending.</p></div></div>'
    ],
    [
      '<div class="model-step reveal"><div class="num">04</div><div><h3>Stronger Communities</h3><p>Those outcomes help build stronger communities and stronger local economies.</p></div></div>',
      '<div class="model-step reveal"><div class="num">04</div><div><h3>Stronger Communities</h3><p>Those outcomes contribute to stronger communities and local economic growth.</p></div></div>'
    ],
    [
      '<p>APROPOS BUSINESS OPPORTUNITY AGENCY works to make relevant public-sector opportunities easier for businesses to discover and pursue.</p>',
      '<p>APROPOS BUSINESS OPPORTUNITY AGENCY works to improve access to relevant public-sector opportunities and the resources businesses need to pursue them.</p>'
    ],
    [
      '<div class="opportunity-item reveal"><span class="index">02</span><strong>Private-sector business opportunities</strong></div>',
      '<div class="opportunity-item reveal"><span class="index">02</span><strong>Buyer connections</strong></div>'
    ],
    [
      '<p>APROPOS BUSINESS OPPORTUNITY AGENCY is designed to organize its work within the communities it serves.</p>',
      '<p>APROPOS BUSINESS OPPORTUNITY AGENCY works to strengthen the connection between businesses and the opportunities, buyers, resources, capital, and partnerships that can contribute to economic growth within the communities we serve.</p>'
    ],
    [
      '<p>From there, the Agency can help identify the businesses, institutions, buyers, resources, partners, and opportunities that form the local economic ecosystem.</p>',
      '<p>Each community presents different businesses, industries, resources, institutions, buyers, and economic opportunities.</p>'
    ],
    [
      '<p>This creates an opportunity-development infrastructure focused on generating greater business participation and economic activity within the community.</p>',
      '<p>Our work is designed to identify those connections and help transform opportunity into greater business participation and economic activity.</p>'
    ],
    [
      '<div class="cause-row reveal"><div class="cause">A contract creates revenue.</div><div class="effect">Revenue can give a capable business room to invest, expand, and strengthen operations.</div></div>',
      '<div class="cause-row reveal"><div class="cause">Opportunity can create revenue.</div><div class="effect">Revenue can give a capable business room to invest, expand, and strengthen operations.</div></div>'
    ],
    [
      '<div class="impact-copy-grid reveal"><div><p>When people gain access to meaningful employment, greater financial stability, and new opportunities for advancement, the benefits extend beyond the workplace.</p><p>Families gain greater economic security. Local purchasing power increases. Businesses gain customers. Neighborhoods gain economic activity. Communities become more resilient.</p></div><p class="impact-last">Economic development ultimately becomes meaningful when opportunity reaches people.</p></div>',
      '<div class="impact-copy-grid reveal"><div><p>When businesses gain access to meaningful opportunities, they gain new pathways to generate revenue, expand operations, create jobs, engage suppliers, and invest in the communities where they operate.</p><p>When people gain access to meaningful employment, greater financial stability, and opportunities for advancement, families become stronger and communities become more resilient.</p></div><p class="impact-last">Economic development ultimately becomes meaningful when opportunity reaches people.</p></div>'
    ],
    [
      '<p>Whether you are a business seeking procurement intelligence, an organization exploring partnership, or a supporter interested in advancing business opportunity, we welcome the conversation.</p>',
      '<p>Whether you are a business seeking opportunity, an organization exploring partnership, or a supporter interested in advancing economic and community growth, we welcome the conversation.</p>'
    ]
  ];

  for (const [from, to] of replacements) {
    html = html.split(from).join(to);
  }

  return html;
}

export default async (request, context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = refineMessaging(await response.text());
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.set("cache-control", "public, max-age=0, must-revalidate");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
