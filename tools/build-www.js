const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'www');
const files = [
  'index.html',
  'styles.css',
  'script.js',
  'manifest.webmanifest',
  'sw.js',
];
const apiBase = String(process.env.CALC_API_BASE || 'http://192.168.1.151:8000')
  .trim()
  .replace(/\/+$/, '');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(outDir, file));
}

fs.cpSync(path.join(root, 'icons'), path.join(outDir, 'icons'), { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'config.js'),
  [
    `window.CALC_API_BASE = ${JSON.stringify(apiBase)};`,
    'window.CALC_NATIVE = true;',
    '',
  ].join('\n')
);

console.log('Android web bundle: ' + outDir);
console.log('AI API base: ' + apiBase);
console.log('Set CALC_API_BASE to your deployed HTTPS URL for a production build.');
