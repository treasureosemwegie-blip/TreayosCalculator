const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const dist = path.join(root, 'dist');
const destination = path.join(dist, 'TreayosCalculator-debug.apk');

if (!fs.existsSync(source)) {
  throw new Error('Debug APK not found at ' + source);
}

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(source, destination);

console.log('APK copied to ' + destination);
