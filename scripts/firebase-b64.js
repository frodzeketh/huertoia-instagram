/**
 * Genera FIREBASE_SERVICE_ACCOUNT_BASE64 para pegar en Railway.
 * Uso: npm run firebase:b64
 */
require('dotenv').config();

const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
if (!raw) {
  console.error('Falta FIREBASE_SERVICE_ACCOUNT en .env local');
  process.exit(1);
}

let json = raw;
if ((json.startsWith("'") && json.endsWith("'")) || (json.startsWith('"') && json.endsWith('"'))) {
  json = json.slice(1, -1);
}

JSON.parse(json); // validar
const b64 = Buffer.from(json, 'utf8').toString('base64');
console.log('\nPega esto en Railway → Variables:\n');
console.log('FIREBASE_SERVICE_ACCOUNT_BASE64=' + b64);
console.log('\n(No hace falta FIREBASE_SERVICE_ACCOUNT en Railway si usas BASE64)\n');
