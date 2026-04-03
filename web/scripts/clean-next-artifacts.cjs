const fs = require('fs');
const path = require('path');

const targets = [path.join(process.cwd(), '.next')];

for (const target of targets) {
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[clean-next-artifacts] removed ${target}`);
    }
  } catch (error) {
    console.warn(`[clean-next-artifacts] skip ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
