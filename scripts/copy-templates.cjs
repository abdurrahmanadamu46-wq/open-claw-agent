const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src', 'content', 'templates');
const dest = path.join(__dirname, '..', 'dist', 'content', 'templates');
if (!fs.existsSync(src)) process.exit(0);
fs.mkdirSync(dest, { recursive: true });
function copyDir(a, b) {
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const ap = path.join(a, e.name);
    const bp = path.join(b, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(bp, { recursive: true });
      copyDir(ap, bp);
    } else {
      fs.copyFileSync(ap, bp);
    }
  }
}
copyDir(src, dest);
console.log('Templates copied to dist/content/templates');
