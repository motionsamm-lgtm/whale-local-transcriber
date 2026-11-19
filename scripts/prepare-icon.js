const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const encodedIcon = path.join(root, 'assets', 'app-icon.ico.base64');
const outputIcon = path.join(root, 'assets', 'app-icon.ico');

if (!fs.existsSync(encodedIcon)) {
  throw new Error(`Windows icon source is missing: ${encodedIcon}`);
}

const base64 = fs.readFileSync(encodedIcon, 'utf8').replace(/\s+/g, '');
const icon = Buffer.from(base64, 'base64');
if (icon.length < 256 || icon.subarray(0, 4).toString('hex') !== '00000100') {
  throw new Error('Windows icon source is not a valid ICO file.');
}

fs.writeFileSync(outputIcon, icon);
console.log(`Prepared Whale Local icon (${icon.length.toLocaleString()} bytes).`);
