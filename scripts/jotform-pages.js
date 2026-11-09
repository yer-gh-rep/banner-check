// Report / landing pages that embed a Jotform. Add new pages here.
export const JOTFORM_PAGES = [
  // Newest first within each country. UTM parameters are intentionally left off.
  { name: "Australia Fintech Map 2026", url: "https://fintechnews.au/australia-fintech-map-2026/" },
  { name: "Malaysia Fintech Report 2026", url: "https://fintechnews.my/malaysia-fintech-report-2026/" },
  { name: "Singapore Digital Banking Report 2026", url: "https://fintechnews.sg/singapore-digital-banking-report-2026/" },
  { name: "Philippines Fintech Report 2026", url: "https://fintechnews.ph/fintech-philippines-report-2026/" },
  { name: "Singapore Fintech Report 2025", url: "https://fintechnews.sg/fintech-singapore-report-2025/" },
  { name: "Malaysia Fintech Report 2025", url: "https://fintechnews.my/malaysia-fintech-report-2025/" },
  { name: "Hong Kong Fintech Report 2025", url: "https://fintechnews.hk/hong-kong-fintech-report-2025-download/" },
  { name: "Indonesia Fintech Report 2025", url: "https://fintechnews.id/fintech-indonesia-report-2025/" },
  { name: "Singapore Fintech Report 2024", url: "https://fintechnews.sg/fintech-singapore-report-2024/" },
  { name: "Malaysia Fintech Report 2024", url: "https://fintechnews.my/malaysia-fintech-report-2024-download/" },
  { name: "Philippines Fintech Report 2024", url: "https://fintechnews.ph/fintech-philippines-report-2024/" },
  { name: "UAE Fintech Report 2024", url: "https://fintechnews.ae/uae-fintech-report-2024-download/" },
  { name: "Singapore Fintech Report 2023", url: "https://fintechnews.sg/fintech-singapore-report-2023/" },
  { name: "Malaysia Fintech Report 2023", url: "https://fintechnews.my/malaysia-fintech-report-2023/" },
  { name: "Philippines Fintech Report 2023", url: "https://fintechnews.ph/fintech-philippines-report-2023-2/" },
];

// Mobile viewport (same size as the banner check) with a real mobile UA.
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Extra time given to the form after the page has loaded (ms). Jotform is
// injected by a deferred script and then renders inside an iframe, so it
// shows up well after the page "load" event.
export const FORM_EXTRA_WAIT_MS = 8000;

// Max time to wait for the form fields to appear inside the iframe (ms).
export const FORM_READY_TIMEOUT_MS = 30000;

// Minimum number of visible inputs for the form to count as "displayed".
export const MIN_VISIBLE_FIELDS = 2;

export const JOTFORM_RETENTION_DAYS = 56; // 8 weekly runs
