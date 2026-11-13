// Publishes public/ to the gh-pages branch, which GitHub Pages serves.
// Run after `npm run deploy` and after setting the Worker URL in public/config.js.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = cmd => execSync(cmd, { stdio: 'inherit' });
const out = cmd => execSync(cmd, { encoding: 'utf8' }).trim();

const config = fs.readFileSync(path.join(__dirname, '..', 'public', 'config.js'), 'utf8');
if (!/ALPENDRE_API\s*=\s*'https:\/\/[^']+'/.test(config)) {
  console.error("public/config.js has no Worker URL yet. Set window.ALPENDRE_API = 'https://alpendre.<you>.workers.dev' first.");
  process.exit(1);
}
if (out('git status --porcelain public')) {
  console.error('public/ has uncommitted changes. Commit them first so the published site matches the repo.');
  process.exit(1);
}

run('git subtree split --prefix public -b gh-pages-build');
try { run('git push -f origin gh-pages-build:gh-pages'); }
finally { run('git branch -D gh-pages-build'); }
console.log('\nPublished. GitHub Pages updates in a minute or two.');
