const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'agent', 'commander', 'config');
const dest = path.join(__dirname, '..', 'dist', 'agent', 'commander', 'config');

if (!fs.existsSync(src)) process.exit(0);

fs.mkdirSync(dest, { recursive: true });

for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
}

console.log('Commander assets copied to dist/agent/commander/config');
