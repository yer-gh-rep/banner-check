// One entry per site. `home` is checked as-is; the latest article link is
// discovered automatically from the homepage on each run.
export const SITES = [
  { name: "Singapore", url: "https://fintechnews.sg" },
  { name: "UAE", url: "https://fintechnews.ae" },
  { name: "Africa", url: "https://fintechnews.africa" },
  { name: "Malaysia", url: "https://fintechnews.my" },
  { name: "Indonesia", url: "https://fintechnews.id" },
  { name: "Philippines", url: "https://fintechnews.ph" },
  { name: "Baltic", url: "https://fintechbaltic.com" },
  { name: "Nordics", url: "https://fintechnordics.com" },
  { name: "Australia", url: "https://fintechnews.au" },
  { name: "Hong Kong", url: "https://fintechnews.hk" },
  { name: "Switzerland", url: "https://fintechnews.ch" },
  { name: "Americas", url: "https://fintechnews.am" },
];

// Banner placements to check on every page. `selector` finds the slot,
// `renderedCheck` decides whether something actually loaded into it
// (vs. an empty/collapsed placeholder).
export const BANNER_CHECKS = [
  {
    key: "top-banner",
    label: "Top banner (above header)",
    selector: ".ad-banner-a, .ad-banner-a-mobile",
  },
  {
    key: "in-content-banner",
    label: "In-content banner (above Recent News / above featured image)",
    selector: ".ad-banner",
  },
  {
    key: "sidebar-widgets",
    label: "Sidebar ad widgets (Google Ad Manager slots)",
    selector: '[id^="div-gpt-ad-"]',
  },
];

// How many days of screenshot folders to keep in the gallery/repo.
export const RETENTION_DAYS = 14;
