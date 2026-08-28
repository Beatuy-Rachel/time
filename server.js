const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 8080);
const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : process.env.POSTGRES_HOST && process.env.POSTGRES_PASSWORD
    ? { host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB || 'time_record', user: process.env.POSTGRES_USER || 'time_record', password: process.env.POSTGRES_PASSWORD }
    : null;
const TOKEN_SECRET = process.env.AUTH_SECRET || 'change-this-auth-secret';
const MAX_BODY = 2 * 1024 * 1024;
const pool = databaseConfig ? new Pool({ ...databaseConfig, max: 10, idleTimeoutMillis: 30000 }) : null;

function id(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':'); if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex'); return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function encodeToken(userId) { const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url'); return `${payload}.${crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url')}`; }
function tokenUser(request) {
  const [payload, signature] = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').split('.'); if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url'); if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.exp > Date.now() ? data.userId : null; } catch { return null; }
}
function send(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
function readBody(request) { return new Promise((resolve, reject) => { let raw = ''; let size = 0; request.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) reject(new Error('body too large')); else raw += chunk; }); request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); } }); request.on('error', reject); }); }
function safeEmail(value) { return String(value || '').trim().toLowerCase(); }
function publicUser(user) { return { id: user.id, email: user.email, createdAt: user.created_at }; }

async function initDatabase() {
  if (!pool) throw new Error('PostgreSQL configuration is required');
  await pool.query('CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
  await pool.query("CREATE TABLE IF NOT EXISTS user_data (user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, payload jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())");
}
async function handleApi(request, response, url) {
  if (request.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
    const body = await readBody(request); const email = safeEmail(body.email); const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return send(response, 400, { error: '请输入有效邮箱，密码至少 8 位' });
    const userId = id(email); const existing = (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
    if (url.pathname.endsWith('register') && existing) return send(response, 409, { error: '该邮箱已经注册' });
    if (url.pathname.endsWith('login') && (!existing || !verifyPassword(password, existing.password_hash))) return send(response, 401, { error: '邮箱或密码不正确' });
    const user = existing || (await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *', [userId, email, hashPassword(password)])).rows[0];
    const data = (await pool.query('SELECT updated_at FROM user_data WHERE user_id = $1', [user.id])).rows[0]; return send(response, 200, { token: encodeToken(user.id), user: publicUser(user), updatedAt: data?.updated_at || '', hasData: Boolean(data) });
  }
  const userId = tokenUser(request); if (!userId) return send(response, 401, { error: '请先登录' });
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0]; if (!user) return send(response, 401, { error: '账号不存在' });
  if (request.method === 'GET' && url.pathname === '/api/auth/me') return send(response, 200, { user: publicUser(user) });
  if (url.pathname === '/api/sync' && request.method === 'GET') { const row = (await pool.query('SELECT payload, updated_at FROM user_data WHERE user_id = $1', [userId])).rows[0]; return send(response, 200, { payload: row?.payload || {}, updatedAt: row?.updated_at || '' }); }
  if (url.pathname === '/api/sync' && request.method === 'PUT') { const body = await readBody(request); if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return send(response, 400, { error: '同步数据格式不正确' }); const row = (await pool.query('INSERT INTO user_data (user_id, payload) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now() RETURNING updated_at', [userId, JSON.stringify(body.payload)])).rows[0]; return send(response, 200, { updatedAt: row.updated_at }); }
  return send(response, 404, { error: '接口不存在' });
}
const server = http.createServer(async (request, response) => {
  try { const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url); const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''); const rootPath = path.resolve(__dirname); const filePath = path.resolve(rootPath, file); const relativePath = path.relative(rootPath, filePath); if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(response, 404, { error: '未找到页面' }); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }; response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': file === 'sw.js' ? 'no-cache' : 'no-store' }); fs.createReadStream(filePath).pipe(response); } catch (error) { if (!response.headersSent) send(response, error.message === 'body too large' ? 413 : 500, { error: '请求无法处理' }); }
});
initDatabase().then(() => server.listen(PORT, () => console.log(`Time record server listening on ${PORT}`))).catch(error => { console.error('Database initialization failed:', error.message); process.exit(1); });
