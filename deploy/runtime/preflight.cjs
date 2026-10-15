// Inspect the image and query the database without starting Strapi or its workers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function schemaHash(root = process.cwd()) {
  const files = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'schema.json' || (file.includes('/src/components/') && entry.name.endsWith('.json'))) files.push(file);
    }
  }
  walk(path.join(root, 'src'));
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) hash.update(path.relative(root, file) + '\0').update(fs.readFileSync(file)).update('\0');
  return hash.digest('hex');
}

async function databaseCheck(env = process.env) {
  const options = { host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USERNAME,
    password: env.DATABASE_PASSWORD, database: env.DATABASE_NAME };
  if (env.DATABASE_CLIENT === 'postgres') {
    const client = new (require('pg').Client)({ ...options, connectionString: env.DATABASE_URL || undefined,
      connectionTimeoutMillis: 8000, query_timeout: 8000,
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : false });
    try { await client.connect(); await client.query('SELECT 1'); } finally { await client.end(); }
  } else if (['mysql', 'mysql2'].includes(env.DATABASE_CLIENT)) {
    const client = await require('mysql2/promise').createConnection({ ...options, connectTimeout: 8000 });
    try { await client.query('SELECT 1'); } finally { await client.end(); }
  } else throw new Error('Unsupported production database');
}

async function main() {
  const release = JSON.parse(fs.readFileSync('.release.json', 'utf8'));
  if (!/^[a-f0-9]{40}-[0-9]+-[0-9]+$/.test(release.releaseId)) throw new Error('Invalid release');
  if (fs.existsSync('.env') || fs.existsSync('.git')) throw new Error('Private build context included');
  const admin = ['build/index.html', 'dist/build/index.html'].find(file => fs.existsSync(file));
  if (!admin || !fs.readFileSync(admin, 'utf8').includes('<html')) throw new Error('Admin panel not built');
  const strapiVersion = require('@strapi/strapi/package.json').version;
  if (!process.argv.includes('--image-only')) await databaseCheck();
  console.log(JSON.stringify({ ...release, schemaHash: schemaHash(), strapiVersion, adminBuilt: true }));
}

module.exports = { schemaHash, databaseCheck };
if (require.main === module) main().catch(() => { console.error('CMS preflight failed; credentials and database errors suppressed'); process.exitCode = 1; });
