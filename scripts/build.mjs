// Builds the deployable site in dist/ from the one source file, index.html.
//
// index.html is the docs page exactly as exported from the Claude artifact.
// Everything agents read (llms.txt, llms-full.txt, one Markdown file per
// page, sitemap.xml) is generated from it here, on every deploy, so the
// agent versions can never drift from what people see. To update the docs,
// replace index.html with a fresh export and push.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SITE = 'https://docs.percepteye.ai';
const OUT = 'dist';

let html = readFileSync('index.html', 'utf8');

// 1. Drop claude.ai's host wrapper if a fresh export still carries it.
html = html.replace(/<!-- frame-runtime -->[\s\S]*?<!-- \/frame-runtime -->/, '');

// 2. Page metadata, from the page's own data so it cannot disagree with it.
const PAGES = JSON.parse(html.match(/const PAGES=(\[[^\n]*?\]);const SEARCH=/)[1]);
const intro = PAGES.find((p) => p.id === 'introduction');
if (!intro) throw new Error('index.html has no "introduction" page');

// 3. Markdown for every page.
// Parse <pre> as markup (the default keeps it as raw text) so code keeps only its text.
const PARSE = { blockTextElements: { script: true, style: true } };
const doc = parse(html, PARSE);
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.use(gfm);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mdUrl = (id, anchor) => `${SITE}/${id}.md${anchor ? `#${anchor}` : ''}`;

function pageMarkdown(p) {
  const art = doc.querySelector(`#p-${p.id}`);
  if (!art) throw new Error(`page "${p.id}" is listed in PAGES but has no <article id="p-${p.id}">`);
  const a = parse(art.toString(), PARSE).firstChild;

  // Tabbed terminal on the landing page: one labelled code block per tab.
  for (const term of a.querySelectorAll('.term')) {
    const labels = Object.fromEntries(term.querySelectorAll('[data-term]').map((b) => [b.getAttribute('data-term'), b.text.trim()]));
    const blocks = term.querySelectorAll('pre.term-body').map((pre) =>
      `<p><strong>${esc(labels[pre.getAttribute('data-term-body')] || '')}</strong></p><pre><code class="language-text">${esc(pre.text)}</code></pre>`);
    term.replaceWith(blocks.join(''));
  }
  // Highlighted code blocks: plain text with the language kept.
  for (const hl of a.querySelectorAll('.hl')) {
    const code = hl.querySelector('code');
    const lang = (code?.getAttribute('class') || '').match(/language-(\S+)/)?.[1] || '';
    hl.replaceWith(`<pre><code class="language-${lang}">${esc((code || hl.querySelector('pre')).text)}</code></pre>`);
  }
  // Callouts become quoted notes.
  for (const c of a.querySelectorAll('.callout')) {
    const label = c.querySelector('.callout-label');
    const name = label ? label.text.trim() : 'Note';
    label?.remove();
    c.replaceWith(`<blockquote><p><strong>${esc(name)}:</strong></p>${c.innerHTML}</blockquote>`);
  }
  // Card grids on the landing page (a bold title and a line of text each)
  // become bulleted lists; laid out as text they would run together.
  for (const grid of a.querySelectorAll('.paths, .g-grid, .stats')) {
    const items = grid.childNodes.filter((n) => n.nodeType === 1).map((card) => {
      card.querySelector('.pi')?.remove();
      const title = card.querySelector('b');
      const rest = card.querySelector('span');
      const head = card.tagName === 'A' ? `<a href="${card.getAttribute('href')}" data-page="${card.getAttribute('data-page')}">${title.text}</a>` : `<strong>${title.innerHTML}</strong>`;
      return `<li>${head}${grid.classList.contains('stats') ? ' ' : ': '}${rest ? rest.innerHTML : ''}</li>`;
    });
    grid.replaceWith(`<ul>${items.join('')}</ul>`);
  }
  // A line break inside a heading would end the Markdown heading early.
  for (const br of a.querySelectorAll('h1 br, h2 br, h3 br')) br.replaceWith(' ');
  // Decoration and navigation chrome have no meaning in text.
  for (const sel of ['svg', 'button', '[aria-hidden="true"]', '.crumb', '.pn', '.chip', '.hl-bar']) {
    for (const el of a.querySelectorAll(sel)) el.remove();
  }
  // Links between pages point at the Markdown versions.
  for (const link of a.querySelectorAll('a[data-page]')) {
    link.setAttribute('href', mdUrl(link.getAttribute('data-page'), link.getAttribute('data-anchor')));
  }
  let md = td.turndown(a.innerHTML).replace(/\n{3,}/g, '\n\n').trim();
  if (!md.startsWith('# ')) md = `# ${p.title}\n\n${md}`;
  return `${md}\n\n---\nSource: ${SITE}/#${p.id} · Index: ${SITE}/llms.txt\n`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const markdown = PAGES.map((p) => ({ p, md: pageMarkdown(p) }));
for (const { p, md } of markdown) writeFileSync(`${OUT}/${p.id}.md`, md);

// 4. llms.txt: the index agents look for first (https://llmstxt.org).
const sections = [];
for (const p of PAGES) {
  const key = p.tab === 'Documentation' ? p.group : p.tab;
  let s = sections.find((x) => x.key === key);
  if (!s) sections.push((s = { key, pages: [] }));
  s.pages.push(p);
}
writeFileSync(`${OUT}/llms.txt`, [
  `# ${intro.title}`,
  '',
  `> ${intro.desc}`,
  '',
  `Every page below is plain Markdown. All pages in one file: ${SITE}/llms-full.txt`,
  '',
  ...sections.flatMap((s) => [`## ${s.key}`, '', ...s.pages.map((p) => `- [${p.title}](${mdUrl(p.id)}): ${p.desc}`), '']),
].join('\n'));
writeFileSync(`${OUT}/llms-full.txt`, markdown.map(({ md }) => md).join('\n\n'));

// 5. The human page: highlight.js moves to its own cached file, and the head
//    gains a description and pointers to the agent versions. Nothing visible changes.
const HLJS = /<!--claude-hljs-runtime-begin:\d+-->([\s\S]*?)<!--claude-hljs-runtime-end-->/;
const hl = html.match(HLJS);
if (hl) {
  const js = [...hl[1].matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(';\n');
  writeFileSync(`${OUT}/hljs.js`, js);
  html = html.replace(HLJS, '<script src="/hljs.js"></script>');
} else {
  console.warn('warning: no highlight.js block found; index.html ships with whatever scripts it has inline');
}
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
html = html.replace(/<head>/, `<head>
<meta name="description" content="${attr(intro.desc)}">
<link rel="canonical" href="${SITE}/">
<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">
<link rel="alternate" type="text/markdown" title="Docs as Markdown" href="/llms-full.txt">`);
writeFileSync(`${OUT}/index.html`, html);

// 6. sitemap.xml and robots.txt. The page's sections are #fragments, which
//    crawlers treat as one URL, so the sitemap lists the Markdown files too.
const urls = [`${SITE}/`, `${SITE}/llms.txt`, `${SITE}/llms-full.txt`, ...PAGES.map((p) => mdUrl(p.id))];
writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`built ${PAGES.length} pages: index.html ${(html.length / 1024).toFixed(0)} KB` +
  (hl ? `, hljs.js ${(hl[1].length / 1024).toFixed(0)} KB` : ''));
