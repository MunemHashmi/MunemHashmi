import fs from 'node:fs/promises';

const owner = process.env.PROFILE_OWNER || 'MunemHashmi';
const token = process.env.GITHUB_TOKEN;

const progressBarWidth = 20;
const contributionSearchUrl = `https://github.com/pulls?q=is%3Apr+author%3A${owner}`;
const publicPRQuery = `author:${owner} type:pr is:public`;

function githubHeaders(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'profile-readme-updater',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function gh(url, init = {}) {
  const target = url.startsWith('http') ? url : `https://api.github.com${url}`;
  const res = await fetch(target, {
    ...init,
    headers: githubHeaders(init.headers),
  });

  if (!res.ok) {
    throw new Error(`GitHub request failed ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function searchIssues(query, options = {}) {
  const params = new URLSearchParams({
    q: query,
    per_page: String(options.perPage ?? 100),
    page: String(options.page ?? 1),
  });

  if (options.sort) params.set('sort', options.sort);
  if (options.order) params.set('order', options.order);

  return gh(`/search/issues?${params}`);
}

async function searchCount(query) {
  const data = await searchIssues(query, { perPage: 1 });
  if (typeof data.total_count !== 'number') {
    throw new Error(`Unexpected search response for ${query}: ${JSON.stringify(data)}`);
  }
  return data.total_count;
}

async function searchAllIssues(query) {
  const items = [];
  let page = 1;

  while (true) {
    const data = await searchIssues(query, { perPage: 100, page });
    items.push(...data.items);

    if (data.items.length < 100 || items.length >= data.total_count) {
      return items;
    }

    page += 1;
  }
}

async function listOwnedRepos(login) {
  const repos = [];
  let page = 1;

  while (true) {
    const data = await gh(`/users/${login}/repos?type=owner&sort=updated&per_page=100&page=${page}`);
    repos.push(...data);

    if (data.length < 100) {
      return repos;
    }

    page += 1;
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function formatTimestamp(date) {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function renderBarChart(value, max, width = progressBarWidth) {
  const filled = Math.round((value / Math.max(max, 1)) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function badgeUrl(label, message, color, options = {}) {
  const params = new URLSearchParams({ style: options.style ?? 'for-the-badge' });
  if (options.logo) params.set('logo', options.logo);
  return `https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(message)}-${color}?${params}`;
}

function replaceBlock(readme, start, end, content) {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  return readme.replace(pattern, `${start}\n${content}\n${end}`);
}

const langMeta = {
  TypeScript:       { color: '3178C6', logo: 'typescript' },
  JavaScript:       { color: 'F7DF1E', logo: 'javascript', textColor: 'black' },
  Go:               { color: '00ADD8', logo: 'go' },
  Python:           { color: '3776AB', logo: 'python' },
  Rust:             { color: '000000', logo: 'rust' },
  'C++':            { color: '00599C', logo: 'cplusplus' },
  'C#':             { color: '239120', logo: 'csharp' },
  Shell:            { color: '4EAA25', logo: 'gnubash' },
  Java:             { color: 'ED8B00', logo: 'openjdk' },
  Swift:            { color: 'F05138', logo: 'swift' },
  Kotlin:           { color: '7F52FF', logo: 'kotlin' },
  Ruby:             { color: 'CC342D', logo: 'ruby' },
  PHP:              { color: '777BB4', logo: 'php' },
  Dart:             { color: '0175C2', logo: 'dart' },
  CSS:              { color: '1572B6', logo: 'css3' },
  HTML:             { color: 'E34F26', logo: 'html5' },
  'Jupyter Notebook': { color: 'F37626', logo: 'jupyter' },
  Vue:              { color: '4FC08D', logo: 'vuedotjs' },
  Docker:           { color: '2496ED', logo: 'docker' },
  PostgreSQL:       { color: '4169E1', logo: 'postgresql' },
};

function buildLangBadges(repos) {
  const counts = {};
  for (const repo of repos) {
    const lang = repo.language;
    if (lang) counts[lang] = (counts[lang] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang]) => {
      const meta = langMeta[lang] || { color: '555555' };
      const encoded = lang.replace(/ /g, '%20').replace(/#/g, '%23').replace(/\+/g, '%2B');
      const textColor = meta.textColor || 'white';
      const logoPart = meta.logo ? `&logo=${meta.logo}&logoColor=${textColor}` : '';
      return `![${lang}](https://img.shields.io/badge/${encoded}-${meta.color}?style=flat-square${logoPart})`;
    })
    .join('\n');
}

async function main() {
  const [
    profile,
    totalPRs,
    mergedPRs,
    closedPRs,
    openPRs,
    prs30d,
    merged30d,
    allPRs,
    ownedRepos,
  ] = await Promise.all([
    gh(`/users/${owner}`),
    searchCount(publicPRQuery),
    searchCount(`${publicPRQuery} is:merged`),
    searchCount(`${publicPRQuery} is:closed`),
    searchCount(`${publicPRQuery} is:open`),
    searchCount(`${publicPRQuery} created:>=${isoDaysAgo(30)}`),
    searchCount(`${publicPRQuery} is:merged merged:>=${isoDaysAgo(30)}`),
    searchAllIssues(publicPRQuery),
    listOwnedRepos(owner),
  ]);

  const acceptanceRate = (mergedPRs / Math.max(closedPRs, 1)) * 100;
  const totalStars = ownedRepos
    .filter((repo) => !repo.fork)
    .reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0);
  const reposContributed = new Set(
    allPRs.map((item) => item.repository_url.split('/').slice(-2).join('/')),
  ).size;

  const badgeBlock = [
    '<p>',
    `  <a href="https://github.com/${owner}?tab=followers"><img src="${badgeUrl('Followers', formatCompactNumber(profile.followers), '181717', { logo: 'github' })}" /></a>`,
    `  <a href="https://github.com/${owner}?tab=repositories"><img src="${badgeUrl('Public Repos', String(profile.public_repos), '181717', { logo: 'github' })}" /></a>`,
    `  <a href="https://github.com/${owner}?tab=repositories"><img src="${badgeUrl('Stars Earned', formatCompactNumber(totalStars), 'f5b301', { logo: 'github' })}" /></a>`,
    `  <a href="${contributionSearchUrl}"><img src="${badgeUrl('Repos via PRs', String(reposContributed), '2f81f7', { logo: 'github' })}" /></a>`,
    '</p>',
    '<p>',
    `  <a href="${contributionSearchUrl}"><img src="${badgeUrl('Merge Rate', formatPercent(acceptanceRate), '2ea043', { logo: 'git' })}" /></a>`,
    `  <a href="${contributionSearchUrl}"><img src="${badgeUrl('PRs Merged', String(mergedPRs), '238636', { logo: 'github' })}" /></a>`,
    `  <a href="${contributionSearchUrl}"><img src="${badgeUrl('Open PRs', String(openPRs), 'f85149', { logo: 'github' })}" /></a>`,
    `  <a href="https://github.com/${owner}"><img src="https://komarev.com/ghpvc/?username=${owner}&style=for-the-badge&color=0e75b6" /></a>`,
    '</p>',
  ].join('\n');

  const langBadges = buildLangBadges(ownedRepos);

  const now = formatTimestamp(new Date());
  const numWidth = Math.max(String(totalPRs).length, 3);
  const statsBlock = [
    '<table>',
    '  <tr>',
    '    <td align="center" width="25%">',
    '      <br/>',
    `      <a href="${contributionSearchUrl}+is%3Aclosed">`,
    `        <img src="https://img.shields.io/badge/${encodeURIComponent(formatPercent(acceptanceRate))}-2ea043?style=for-the-badge" />`,
    '      </a><br/>',
    '      <sub><b>MERGE RATE</b></sub><br/>',
    `      <sub>${mergedPRs} / ${closedPRs} closed</sub>`,
    '      <br/><br/>',
    '    </td>',
    '    <td align="center" width="25%">',
    '      <br/>',
    `      <a href="${contributionSearchUrl}">`,
    `        <img src="https://img.shields.io/badge/${totalPRs}-2f81f7?style=for-the-badge" />`,
    '      </a><br/>',
    '      <sub><b>TOTAL PRS</b></sub><br/>',
    '      <sub>all time</sub>',
    '      <br/><br/>',
    '    </td>',
    '    <td align="center" width="25%">',
    '      <br/>',
    `      <a href="${contributionSearchUrl}+is%3Aopen">`,
    `        <img src="https://img.shields.io/badge/${openPRs}-f85149?style=for-the-badge" />`,
    '      </a><br/>',
    '      <sub><b>IN FLIGHT</b></sub><br/>',
    '      <sub>open PRs</sub>',
    '      <br/><br/>',
    '    </td>',
    '    <td align="center" width="25%">',
    '      <br/>',
    `      <a href="${contributionSearchUrl}">`,
    `        <img src="https://img.shields.io/badge/${reposContributed}-a371f7?style=for-the-badge" />`,
    '      </a><br/>',
    '      <sub><b>REPOS TOUCHED</b></sub><br/>',
    '      <sub>via PRs</sub>',
    '      <br/><br/>',
    '    </td>',
    '  </tr>',
    '</table>',
    '',
    '<table>',
    '  <tr>',
    '    <td>',
    `      <code>MERGED ${renderBarChart(mergedPRs, totalPRs)} ${String(mergedPRs).padStart(numWidth)}</code><br/>`,
    `      <code>OPEN   ${renderBarChart(openPRs, totalPRs)} ${String(openPRs).padStart(numWidth)}</code><br/>`,
    `      <code>CLOSED ${renderBarChart(closedPRs, totalPRs)} ${String(closedPRs).padStart(numWidth)}</code><br/>`,
    `      <code>TOTAL  ${renderBarChart(totalPRs, totalPRs)} ${String(totalPRs).padStart(numWidth)}</code>`,
    '    </td>',
    '    <td valign="top">',
    `      <sub><b>30-day pulse</b><br/>${prs30d} PRs opened<br/>${merged30d} PRs merged</sub>`,
    '      <br/><br/>',
    `      <sub>Updated ${now}</sub>`,
    '    </td>',
    '  </tr>',
    '</table>',
  ].join('\n');

  const ossSignalBlock = [
    '<table>',
    '  <tr>',
    '    <td width="280">',
    '      <strong>Public footprint</strong><br />',
    `      <sub>${profile.public_repos} public repos, ${formatCompactNumber(totalStars)} stars earned, ${formatCompactNumber(profile.followers)} followers.</sub>`,
    '    </td>',
    '    <td width="280">',
    '      <strong>Contribution spread</strong><br />',
    `      <sub>${reposContributed} public repositories touched via pull requests, ${totalPRs} public PRs opened in total.</sub>`,
    '    </td>',
    '    <td width="280">',
    '      <strong>Recent pace</strong><br />',
    `      <sub>${prs30d} public PRs opened and ${merged30d} merged in the last 30 days.</sub>`,
    '    </td>',
    '  </tr>',
    '</table>',
  ].join('\n');

  const readmePath = new URL('../README.md', import.meta.url);
  let readme = await fs.readFile(readmePath, 'utf8');

  readme = replaceBlock(readme, '<!-- BADGES:START -->', '<!-- BADGES:END -->', badgeBlock);
  readme = replaceBlock(readme, '<!-- LANGS:START -->', '<!-- LANGS:END -->', langBadges);
  readme = replaceBlock(readme, '<!-- STATS:START -->', '<!-- STATS:END -->', statsBlock);
  readme = replaceBlock(readme, '<!-- OSS_SIGNAL:START -->', '<!-- OSS_SIGNAL:END -->', ossSignalBlock);

  await fs.writeFile(readmePath, readme);
  console.log('README profile sections updated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
