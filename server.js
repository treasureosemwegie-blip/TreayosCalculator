'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ENV_PATH = path.join(__dirname, '.env');

loadEnv(ENV_PATH);

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = String(process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '').trim();
const AI_BASE_URL = String(process.env.AI_BASE_URL || 'https://api.openai.com/v1')
  .trim()
  .replace(/\/+$/, '');
const AI_MODEL = String(process.env.AI_MODEL || 'gpt-4o-mini').trim();
const MAX_BODY_BYTES = Number(process.env.AI_MAX_BODY_BYTES || 12 * 1024 * 1024);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = Number(process.env.AI_RATE_LIMIT || 30);
const GLOBAL_RATE_LIMIT = Number(process.env.AI_GLOBAL_RATE_LIMIT || 240);
const UPSTREAM_TIMEOUT_MS = 60 * 1000;
const EXTRA_CORS_ORIGINS = new Set(
  String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const SYSTEM_PROMPT = [
  'You are the AI assistant built into a calculator app.',
  'Solve math, science, and quantitative problems accurately and clearly.',
  'For arithmetic and algebra, show concise steps, not just the answer.',
  'Give the final answer clearly and include units where relevant.',
  'If an image is attached, read the problem from the image, briefly restate it, and solve it.',
  'Use plain text and simple Unicode math (×, ÷, √, π, ², ³). Avoid LaTeX, HTML, and Markdown tables.',
  'Short bullet lists and bold labels are fine.',
  'If information is missing or ambiguous, state the assumption you are making.',
  'Verify the final result and flag meaningful uncertainty.',
  'Do not claim to have seen an image unless one is attached.',
].join(' ');

const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/script.js', { file: 'script.js', type: 'text/javascript; charset=utf-8' }],
  ['/config.js', { file: 'config.js', type: 'text/javascript; charset=utf-8' }],
  ['/manifest.webmanifest', { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' }],
  ['/sw.js', { file: 'sw.js', type: 'text/javascript; charset=utf-8' }],
  ['/icons/icon-192.png', { file: 'icons/icon-192.png', type: 'image/png' }],
  ['/icons/icon-512.png', { file: 'icons/icon-512.png', type: 'image/png' }],
  ['/icons/icon-512-maskable.png', { file: 'icons/icon-512-maskable.png', type: 'image/png' }],
  ['/icons/apple-touch-icon.png', { file: 'icons/apple-touch-icon.png', type: 'image/png' }],
]);

const buckets = new Map();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key);
  }
}, RATE_WINDOW_MS);
cleanupTimer.unref();

function readEnvFile(file) {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }

  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) values[key] = value;
  }

  return values;
}

function loadEnv(file) {
  const values = readEnvFile(file);
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

let envKeyCache = { value: '', checkedAt: 0 };

function getApiKey() {
  if (API_KEY) return API_KEY;

  const now = Date.now();
  if (now - envKeyCache.checkedAt > 1000) {
    const values = readEnvFile(ENV_PATH);
    envKeyCache = {
      value: String(values.OPENAI_API_KEY || values.AI_API_KEY || '').trim(),
      checkedAt: now,
    };
  }

  return envKeyCache.value;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
  return first.trim() || req.socket.remoteAddress || 'unknown';
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return false;
  if (EXTRA_CORS_ORIGINS.has(origin)) return true;
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin) ||
    /^capacitor:\/\/localhost$/i.test(origin) ||
    /^ionic:\/\/localhost$/i.test(origin)
  );
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '').trim();
  if (!isAllowedCorsOrigin(origin)) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function overLimit(key, limit) {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + RATE_WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  return bucket.count > limit;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, message, extraHeaders = {}) {
  const body = Buffer.from(message);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Request body is too large.');
        error.status = 413;
        reject(error);
        return;
      }

      if (size === 0) {
        const error = new Error('Request body is empty.');
        error.status = 400;
        reject(error);
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const error = new Error('Request body is not valid JSON.');
        error.status = 400;
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function upstreamErrorMessage(data) {
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    if (item && item.error && typeof item.error.message === 'string' && item.error.message.trim()) {
      return item.error.message.trim();
    }
    if (item && typeof item.message === 'string' && item.message.trim()) {
      return item.message.trim();
    }
  }
  return '';
}

function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 24) return null;

  const messages = [];

  for (const message of input) {
    if (!message || typeof message !== 'object') return null;

    const role = message.role;
    if (role === 'system') continue;
    if (role !== 'user' && role !== 'assistant') return null;

    const content = message.content;

    if (typeof content === 'string') {
      const text = content.trim();
      if (!text || text.length > 12000) return null;
      messages.push({ role, content: text });
      continue;
    }

    if (role !== 'user' || !Array.isArray(content) || content.length === 0 || content.length > 5) {
      return null;
    }

    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') return null;

      if (part.type === 'text' && typeof part.text === 'string') {
        const text = part.text.trim();
        if (!text) continue;
        parts.push({ type: 'text', text: text.slice(0, 8000) });
        continue;
      }

      if (part.type === 'image_url' && part.image_url && typeof part.image_url.url === 'string') {
        const url = part.image_url.url;
        if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return null;
        if (url.length > 6 * 1024 * 1024) return null;
        parts.push({ type: 'image_url', image_url: { url } });
        continue;
      }

      return null;
    }

    if (parts.length === 0) return null;
    messages.push({ role: 'user', content: parts });
  }

  return messages.length ? messages : null;
}

async function handleChat(req, res) {
  const apiKey = getApiKey();

  if (!apiKey) {
    sendJson(res, 503, {
      error: { message: 'The AI service is not configured. Set OPENAI_API_KEY on the server.' },
    });
    return;
  }

  const ip = clientIp(req);
  const limitHit = overLimit('ip:' + ip, RATE_LIMIT);
  const globalHit = overLimit('global', GLOBAL_RATE_LIMIT);

  if (limitHit || globalHit) {
    sendJson(
      res,
      429,
      { error: { message: 'Too many AI requests. Please wait a few minutes and try again.' } },
      { 'Retry-After': String(Math.ceil(RATE_WINDOW_MS / 1000)) }
    );
    return;
  }

  const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (contentType !== 'application/json') {
    sendJson(res, 415, { error: { message: 'Send the request as application/json.' } });
    return;
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    sendJson(res, error.status || 400, { error: { message: error.message } });
    return;
  }

  const messages = cleanMessages(payload && payload.messages);
  if (!messages) {
    sendJson(res, 400, { error: { message: 'The conversation payload is not valid.' } });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(AI_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.2,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    const raw = await upstream.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      const message =
        upstreamErrorMessage(data) ||
        'The AI provider returned an error (' + upstream.status + ').';
      const limited = String(message).slice(0, 300);
      const outOfCredits =
        upstream.status === 429 && /quota|credit|billing|insufficient/i.test(limited);
      sendJson(res, outOfCredits ? 402 : upstream.status, { error: { message: limited } });
      return;
    }

    if (!data || typeof data !== 'object') {
      sendJson(res, 502, { error: { message: 'The AI provider returned an invalid response.' } });
      return;
    }

    sendJson(res, 200, data);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      sendJson(res, 504, { error: { message: 'The AI provider took too long to respond.' } });
    } else {
      console.error('AI proxy error:', error && error.message ? error.message : error);
      sendJson(res, 502, { error: { message: 'Could not reach the AI provider.' } });
    }
  } finally {
    clearTimeout(timer);
  }
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }

  const asset = STATIC_FILES.get(pathname);
  if (!asset) {
    sendText(res, 404, 'Not found');
    return;
  }

  try {
    const body = await fsp.readFile(path.join(__dirname, asset.file));
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error('Static file error:', error && error.message ? error.message : error);
    sendText(res, 500, 'Could not load the app.');
  }
}

const server = http.createServer(async (req, res) => {
  let pathname = '/';

  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }

  if (pathname.startsWith('/api/')) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': '0' });
      res.end();
      return;
    }
  }

  if (pathname === '/api/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: { message: 'Method not allowed.' } }, { Allow: 'GET, HEAD' });
      return;
    }
    sendJson(res, 200, { ok: true, configured: Boolean(getApiKey()) });
    return;
  }

  if (pathname === '/api/chat') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: { message: 'Method not allowed.' } }, { Allow: 'POST' });
      return;
    }
    await handleChat(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: { message: 'API route not found.' } });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log('Calculator running at http://localhost:' + PORT);
  if (!getApiKey()) {
    console.warn(
      'AI is not configured. Add OPENAI_API_KEY to .env (or the server environment), then refresh the app.'
    );
  }
});

server.on('error', (error) => {
  console.error('Server error:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
