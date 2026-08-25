'use strict';

// Assembles the static root Vercel serves.
//
// The page stays canonical at project/uploads/index.html; this copies it (and
// only the assets it actually needs) into public/. public/ is generated and
// gitignored, so there is never a second copy of the page to drift out of sync.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'project', 'uploads');
const OUT = path.join(__dirname, 'public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });

fs.copyFileSync(path.join(SRC, 'index.html'), path.join(OUT, 'index.html'));

let fonts = 0;
for (const f of fs.readdirSync(path.join(SRC, 'fonts'))) {
  if (!f.endsWith('.woff2')) continue;
  fs.copyFileSync(path.join(SRC, 'fonts', f), path.join(OUT, 'fonts', f));
  fonts++;
}

console.log(`built public/ — index.html + ${fonts} fonts`);
