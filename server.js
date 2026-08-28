const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_SECRET = process.env.AUTH_SECRET || 'change-this-auth-secret';
const MAX_BODY = 2 * 1024 * 1024;

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
}
function readUsers() {
  ensureStore();
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || {}; } catch { return {}; }
}
function writeUsers(users) {
  ensureStore();
  const temp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(users));
  fs.renameSync(temp, USERS_FILE);
}
function id(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function encodeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function tokenUser(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.exp > Date.now() ? data.userId : null; } catch { return null; }
}
function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''; let size = 0;
    request.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) reject(new Error('body too large')); else raw += chunk; });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); } });
    request.on('error', reject);
  });
}
function safeEmail(value) { return String(value || '').trim().toLowerCase(); }
function publicUser(user) { return { id: user.id, email: user.email, createdAt: user.createdAt }; }

async function handleApi(request, response, url) {
  if (request.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
    const body = await readBody(request); const email = safeEmail(body.email); const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return send(response, 400, { error: '请输入有效邮箱，密码至少 8 位' });
    const users = readUsers(); const userId = id(email); const existing = users[userId];
    if (url.pathname.endsWith('register') && existing) return send(response, 409, { error: '该邮箱已经注册' });
    if (url.pathname.endsWith('login') && (!existing || !verifyPassword(password, existing.passwordHash))) return send(response, 401, { error: '邮箱或密码不正确' });
    const user = existing || { id: userId, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString(), payload: {}, updatedAt: '' };
    users[userId] = user; writeUsers(users);
    return send(response, 200, { token: encodeToken(userId), user: publicUser(user), updatedAt: user.updatedAt || '', hasData: Boolean(user.updatedAt) });
  }
  const userId = tokenUser(request);
  if (!userId) return send(response, 401, { error: '请先登录' });
  const users = readUsers(); const user = users[userId];
  if (!user) return send(response, 401, { error: '账号不存在' });
  if (request.method === 'GET' && url.pathname === '/api/auth/me') return send(response, 200, { user: publicUser(user), updatedAt: user.updatedAt || '', hasData: Boolean(user.updatedAt) });
  if (url.pathname === '/api/sync' && request.method === 'GET') return send(response, 200, { payload: user.payload || {}, updatedAt: user.updatedAt || '' });
  if (url.pathname === '/api/sync' && request.method === 'PUT') {
    const body = await readBody(request);
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return send(response, 400, { error: '同步数据格式不正确' });
    user.payload = body.payload; user.updatedAt = new Date().toISOString(); users[userId] = user; writeUsers(users);
    return send(response, 200, { updatedAt: user.updatedAt });
  }
  return send(response, 404, { error: '接口不存在' });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const filePath = path.resolve(__dirname, file);
    const rootPath = path.resolve(__dirname);
    const relativePath = path.relative(rootPath, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(response, 404, { error: '未找到页面' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': file === 'sw.js' ? 'no-cache' : 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) { if (!response.headersSent) send(response, error.message === 'body too large' ? 413 : 400, { error: '请求无法处理' }); }
});
server.listen(PORT, () => console.log(`Time record server listening on ${PORT}`));
