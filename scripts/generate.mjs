// Builds the profile cards in assets/ from live GitHub data.
// Usage: GITHUB_TOKEN=... node scripts/generate.mjs
// Set INCLUDE_PRIVATE=1 (with a personal token) to count private repositories too.
import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.PROFILE_LOGIN || "abedallaSK";
const TOKEN = process.env.GITHUB_TOKEN;
const INCLUDE_PRIVATE = process.env.INCLUDE_PRIVATE === "1";
// Build and config files that would otherwise drown out real code.
const IGNORED_LANGS = new Set(["Dockerfile", "Cython", "Hack", "PowerShell", "Batchfile", "Shell", "Makefile", "CMake", "Procfile", "Smarty"]);

if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const QUERY = `query($login: String!, $privacy: RepositoryPrivacy) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
    repositories(ownerAffiliations: OWNER, first: 100, privacy: $privacy, isFork: false) {
      totalCount
      nodes {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchUser() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN, privacy: INCLUDE_PRIVATE ? null : "PUBLIC" } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

// Each repository counts once, split by its language mix, so one huge repo cannot dominate.
function languageShares(repos) {
  const totals = new Map();
  for (const repo of repos) {
    const edges = repo.languages.edges.filter((e) => !IGNORED_LANGS.has(e.node.name));
    const size = edges.reduce((s, e) => s + e.size, 0);
    if (!size) continue;
    for (const e of edges) {
      const cur = totals.get(e.node.name) || { name: e.node.name, color: e.node.color || "#8b949e", weight: 0 };
      cur.weight += e.size / size;
      totals.set(e.node.name, cur);
    }
  }
  const all = [...totals.values()].sort((a, b) => b.weight - a.weight);
  const sum = all.reduce((s, l) => s + l.weight, 0);
  const top = all.slice(0, 8).map((l) => ({ ...l, pct: (l.weight / sum) * 100 }));
  const rest = 100 - top.reduce((s, l) => s + l.pct, 0);
  if (rest >= 0.5) top.push({ name: "Other", color: "#6e7681", pct: rest });
  return top;
}

const THEMES = {
  dark: { bg: "#0d1117", border: "#30363d", text: "#e6edf3", muted: "#8b949e", accent: "#00d9ff", tile: "#161b22",
    levels: ["#161b22", "#0b3d4a", "#05637a", "#0095b6", "#00d9ff"] },
  light: { bg: "#ffffff", border: "#d0d7de", text: "#1f2328", muted: "#656d76", accent: "#0277a8", tile: "#f6f8fa",
    levels: ["#ebedf0", "#b3e9f5", "#5fcde6", "#0ea5c9", "#0277a8"] },
};
const LEVEL_INDEX = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

function overviewCard(t, d) {
  const W = 840, H = 300;
  const tiles = d.stats.map((s, i) => {
    const x = 24 + i * 134;
    return `<g transform="translate(${x},64)" class="fade" style="animation-delay:${i * 80}ms">
      <rect width="122" height="76" rx="10" fill="${t.tile}" stroke="${t.border}"/>
      <text x="61" y="36" text-anchor="middle" font-size="24" font-weight="700" fill="${t.accent}">${esc(s.value)}</text>
      <text x="61" y="58" text-anchor="middle" font-size="12" fill="${t.muted}">${esc(s.label)}</text>
    </g>`;
  }).join("");
  const weeks = d.weeks.slice(-53);
  const cells = weeks.map((w, wi) => w.contributionDays.map((day) => {
    const di = new Date(day.date + "T00:00:00Z").getUTCDay();
    return `<rect x="${24 + wi * 15}" y="${172 + di * 15}" width="12" height="12" rx="2.5" fill="${t.levels[LEVEL_INDEX[day.contributionLevel] ?? 0]}"><title>${day.contributionCount} on ${day.date}</title></rect>`;
  }).join("")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${FONT}">
  <style>.fade{opacity:0;animation:in .6s ease forwards}@keyframes in{to{opacity:1}}</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <text x="24" y="40" font-size="18" font-weight="700" fill="${t.text}">GitHub activity</text>
  <text x="${W - 24}" y="40" text-anchor="end" font-size="12" fill="${t.muted}">Last 12 months · updated ${esc(d.updated)}</text>
  ${tiles}
  ${cells}
</svg>`;
}

function languagesCard(t, langs, updated) {
  const W = 840;
  let x = 24;
  const barW = W - 48;
  const bar = langs.map((l, i) => {
    const w = Math.max((l.pct / 100) * barW, 2);
    const r = `<rect x="${x.toFixed(1)}" y="64" width="${w.toFixed(1)}" height="12" fill="${l.color}" class="fade" style="animation-delay:${i * 60}ms"/>`;
    x += w;
    return r;
  }).join("");
  const legend = langs.map((l, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    return `<g transform="translate(${24 + col * 270},${104 + row * 22})">
      <circle cx="6" cy="-4" r="6" fill="${l.color}"/>
      <text x="20" y="0" font-size="13" fill="${t.text}">${esc(l.name)} <tspan fill="${t.muted}">${l.pct.toFixed(1)}%</tspan></text>
    </g>`;
  }).join("");
  const rows = Math.ceil(langs.length / 3);
  const h = 104 + rows * 22 + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" style="${FONT}">
  <style>.fade{opacity:0;animation:in .6s ease forwards}@keyframes in{to{opacity:1}}</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <text x="24" y="40" font-size="18" font-weight="700" fill="${t.text}">Languages across my repositories</text>
  <text x="${W - 24}" y="40" text-anchor="end" font-size="12" fill="${t.muted}">Each repo weighted equally · updated ${esc(updated)}</text>
  <clipPath id="bar"><rect x="24" y="64" width="${barW}" height="12" rx="6"/></clipPath>
  <g clip-path="url(#bar)"><rect x="24" y="64" width="${barW}" height="12" fill="${t.tile}"/>${bar}</g>
  ${legend}
</svg>`;
}

const user = await fetchUser();
const cc = user.contributionsCollection;
const years = Math.floor((Date.now() - new Date(user.createdAt)) / (365.25 * 864e5));
const activeDays = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).filter((d) => d.contributionCount > 0).length;
const data = {
  updated: new Date().toISOString().slice(0, 10),
  weeks: cc.contributionCalendar.weeks,
  stats: [
    { label: "Contributions", value: fmt(cc.contributionCalendar.totalContributions) },
    { label: "Commits", value: fmt(cc.totalCommitContributions + cc.restrictedContributionsCount) },
    { label: "Pull requests", value: fmt(cc.totalPullRequestContributions) },
    { label: INCLUDE_PRIVATE ? "Repositories" : "Public repos", value: fmt(user.repositories.totalCount) },
    { label: "Active days", value: fmt(activeDays) },
    { label: "Years on GitHub", value: `${years}+` },
  ],
};
const langs = languageShares(user.repositories.nodes);

await mkdir("assets", { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(`assets/activity-${name}.svg`, overviewCard(theme, data));
  await writeFile(`assets/languages-${name}.svg`, languagesCard(theme, langs, data.updated));
}
console.log("Cards written:", data.stats.map((s) => `${s.label}=${s.value}`).join(", "));
console.log("Languages:", langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", "));
