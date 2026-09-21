const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const allowedExtensions = new Set([
  '.html', '.htm', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.json', '.toml', '.txt', '.md', '.xml', '.yml', '.yaml', '.css'
]);
const ignoredDirectories = new Set(['.git', '.netlify', 'node_modules']);
const prohibited = new RegExp('non' + '[\\s-]?' + 'profit', 'i');
const failures = [];

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(absolute);
      continue;
    }
    if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const content = fs.readFileSync(absolute, 'utf8');
    if (prohibited.test(content)) failures.push(path.relative(root, absolute));
  }
}

scan(root);

if (failures.length) {
  console.error('Prohibited entity-classification language found in:');
  failures.forEach((file) => console.error(' - ' + file));
  process.exit(1);
}

console.log('ABOA entity-classification validation passed.');
