# PerceptEye docs

The Agent Flywheel documentation served at https://docs.percepteye.ai.

## How it works

`index.html` is the only source. It is the docs page exactly as exported from the Claude artifact: all pages live in it, and the browser switches between them by URL hash (`/#quickstart`).

On every deploy, Vercel runs `npm run build` (`scripts/build.mjs`), which writes the site to `dist/`:

| File | For | What it is |
| --- | --- | --- |
| `index.html` | People | The page, with highlight.js moved out to `hljs.js` and a description plus links to the agent files added to `<head>`. Looks identical. |
| `llms.txt` | Agents | Index of every page with its one-line description and a link to its Markdown ([llmstxt.org](https://llmstxt.org)). |
| `<page>.md` | Agents | Each page as plain Markdown, e.g. `/quickstart.md`. |
| `llms-full.txt` | Agents | All pages in one Markdown file. |
| `sitemap.xml`, `robots.txt` | Crawlers | The page and every Markdown file. |

Because the agent files are generated from `index.html` on each deploy, they cannot drift from what people see.

## Updating the docs

1. Export the updated artifact's HTML and replace `index.html` with it. A leftover claude.ai wrapper is stripped by the build.
2. Optionally check locally: `npm ci && npm run build`, then serve `dist/` (for example `python3 -m http.server -d dist`).
3. Push to `main`. Vercel rebuilds and deploys.

The build fails loudly if the page's structure changes in a way it cannot read (for example a page listed in the navigation with no matching article), rather than publishing incomplete agent files.
