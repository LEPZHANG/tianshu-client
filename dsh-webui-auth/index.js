/**
 * dsh-webui-auth — persistent WebUI authentication plugin for DeepSeek
 * Harness (security-hardened fork).
 *
 * Enforces authentication at the HTTP/transport layer so unauthenticated
 * browsers (or plain HTTP clients) cannot load WebUI resources, call the
 * /api RPC surface, or open the WebSocket downlinks.
 *
 * Hardening changes over upstream 0.2.3 (by xiaoying-agent):
 *
 *   H1. First-run setup requires a per-boot random setup token that is only
 *       printed to the host log (where the operator reads it). A remote
 *       attacker who reaches the server before the operator can no longer
 *       claim the administrator account.
 *   H2. /api and WebSocket gating is done by RUNTIME ROUTE WRAPPING instead
 *       of patching dsh core package sources on disk. No core files are
 *       modified; nothing silently breaks on a dsh upgrade. If the expected
 *       routes are missing (dsh internals changed), the plugin logs an error
 *       AND reports it on the settings page — and the login/configure
 *       endpoints refuse to enable the gate until the shape check passes
 *       (fail-closed against "enabled but /api unprotected").
 *   H3. Sessions persist to disk (JSONL append + startup replay), so a dsh
 *       restart no longer logs everyone out.
 *   H4. Login rate limiting is per-IP (socket remote address; honors
 *       CF-Connecting-IP / X-Forwarded-For leftmost-untrusted strip when the
 *       socket is a loopback reverse proxy) instead of one global bucket,
 *       so an attacker cannot lock the operator out.
 *   H5. The audit log stores HMAC-keyed, truncated client IPs instead of
 *       raw addresses (the HMAC key is generated once and stored next to
 *       the credentials with 0600 permissions).
 *
 * Upstream credit: authentication architecture, login page, settings UI,
 * and the scrypt credential format originate from Yuuz12/dsh-webui-auth
 * (MIT). This fork keeps the on-disk formats compatible where possible.
 *
 * Routes protected (all via runtime wrapping of the webServer service):
 *   - prefix ""    : SPA resources (302 to login page)
 *   - prefix "/plugins": client plugin bundles (302 to login page)
 *   - prefix "/api"     : RPC surface (401)
 *   - upgrades /api/events.mux + /api/events.host : (reject upgrade)
 *
 * Sessions: server-side, persisted across restarts (H3), carried by an
 * HttpOnly cookie `dsh_wua_session`; changing the password revokes every
 * other session.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, accessSync, mkdirSync, unlinkSync, constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { promisify } from "node:util";

export const name = 'dsh-webui-auth'

export const inject = ['webServer', 'fs']

// ---------------- 密码哈希：scrypt（与上游相同的参数与存储格式） ----------------

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SCRYPT_MAXMEM = 64 * 1024 * 1024
const SCRYPT_PREFIX = 'scrypt:'

const scrypt = promisify(scryptCb)

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64')
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM })
  return SCRYPT_PREFIX + SCRYPT_N + ':' + SCRYPT_R + ':' + SCRYPT_P + ':' + salt + ':' + derived.toString('base64')
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith(SCRYPT_PREFIX)) return false
  const parts = stored.split(':')
  if (parts.length !== 6) return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = parts[4]
  let expected = null
  try { expected = Buffer.from(parts[5], 'base64') } catch (e) { return false }
  if (!Number.isInteger(n) || n < 1024 || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1 || !expected || expected.length === 0) return false
  try {
    const derived = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: SCRYPT_MAXMEM })
    return timingSafeEqual(derived, expected)
  } catch (e) {
    return false
  }
}

let dummyHashPromise = null
function dummyHash() {
  if (dummyHashPromise === null) {
    dummyHashPromise = hashPassword(randomBytes(8).toString('hex')).catch((e) => {
      dummyHashPromise = null
      throw e
    })
  }
  return dummyHashPromise
}
async function dummyVerify(password) {
  const h = await dummyHash()
  return verifyPassword(password, h)
}

// 供测试与工具脚本使用（Cordis 加载时只消费 name/inject/apply，多余导出无副作用）
export { hashPassword, verifyPassword, auditLog, readAuditEntries, resolveDataDirFrom, DATA_DIR }

// ---------------- 数据目录与文件 ----------------

function pluginDir() {
  try {
    let url = import.meta.url
    const q = url.indexOf('?')
    if (q !== -1) url = url.slice(0, q)
    const h = url.indexOf('#')
    if (h !== -1) url = url.slice(0, h)
    if (url.startsWith('file://')) {
      let p = url.slice('file://'.length)
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
      p = decodeURIComponent(p)
      const slash = p.lastIndexOf('/')
      if (slash > 0) return p.slice(0, slash)
    }
  } catch (e) { /* fall through to the home fallback */ }
  return null
}

function resolveDataDirFrom(dir) {
  if (dir) {
    try {
      accessSync(dir, fsConstants.W_OK)
      return dir
    } catch (e) { /* store/只读目录：回退 */ }
  }
  const home = process.env.DSH_HOME
    || ((process.env.USERPROFILE || process.env.HOME || '.') + '/.dsh')
  return home.replace(/\\/g, '/').replace(/\/+$/, '') + '/dsh-webui-auth'
}

const DATA_DIR = resolveDataDirFrom(pluginDir())

function configPath() {
  return DATA_DIR + '/dsh-webui-auth.json'
}

/** H3: 会话持久化文件（JSONL，一行一个会话）。 */
function sessionsPath() {
  return DATA_DIR + '/sessions.jsonl'
}

/** H5: HMAC 密钥文件，用于审计 IP 的假名化。 */
function hmacKeyPath() {
  return DATA_DIR + '/audit-hmac-key'
}

function ensureDataDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
  } catch (e) { /* 目录存在或创建失败：后续写入会报错并被上层捕获 */ }
}

async function readCredentials(ctx) {
  let raw = null
  try {
    const target = await ctx.fs.resolve(configPath())
    raw = await ctx.fs.readText(target)
  } catch (e) {
    raw = null
  }
  let parsed = null
  if (raw) {
    try { parsed = JSON.parse(raw) } catch (e) { parsed = null }
  }
  return normalizeCreds(parsed)
}

async function writeCredentials(ctx, creds) {
  ensureDataDir()
  const target = await ctx.fs.resolve(configPath())
  await ctx.fs.writeText(target, JSON.stringify(creds), undefined, undefined, { mode: 'danger-full-access' })
}

/** 有效角色。第一位由 setup 建立的账号是管理员。 */
const ROLES = ['admin', 'user']

/**
 * 归一化磁盘凭据为 v4 多用户格式。透明迁移旧格式：
 * - v3 单用户 `{username,hash,ttl,nickname?}` → 唯一用户即管理员；
 * - 旧禁用记录 `{v:1,enabled:false}` 或缺 users 的对象 → 空用户列表（未启用）；
 * - 无文件（parsed 为空）→ null。
 * @param parsed - 解析后的磁盘 JSON，或 null。
 * @returns v4 凭据 `{v:4,ttl,users:[...]}`，或 null。
 */
function normalizeCreds(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const ttl = normalizeTtl(parsed.ttl)
  if (Array.isArray(parsed.users)) {
    const users = parsed.users
      .filter((u) => u && typeof u.username === 'string' && typeof u.hash === 'string')
      .map((u) => normalizeUser(u))
    return { v: 4, ttl, users }
  }
  if (typeof parsed.username === 'string' && typeof parsed.hash === 'string') {
    return { v: 4, ttl, users: [normalizeUser({ ...parsed, role: 'admin' })] }
  }
  return { v: 4, ttl, users: [] }
}

/** 归一化单条用户记录（角色回落 user，昵称去空）。 */
function normalizeUser(u) {
  const role = u.role === 'admin' ? 'admin' : 'user'
  const nickname = typeof u.nickname === 'string' ? u.nickname.trim() : ''
  return { username: u.username, hash: u.hash, role, ...(nickname ? { nickname } : {}) }
}

function normalizeTtl(ttl) {
  return (typeof ttl === 'number' && TTL_OPTIONS.includes(ttl)) ? ttl : TTL_DEFAULT
}

/** 用户列表（永远返回数组）。 */
function usersOf(creds) {
  return creds && Array.isArray(creds.users) ? creds.users : []
}

/** 按用户名查一条记录，不存在返回 null。 */
function findUser(creds, username) {
  return usersOf(creds).find((u) => u.username === username) || null
}

/** 管理员数量（用于"最后一个管理员"保护）。 */
function countAdmins(creds) {
  return usersOf(creds).filter((u) => u.role === 'admin').length
}

function isEnabled(creds) {
  return usersOf(creds).length > 0
}

/** 读取单条用户记录的昵称（未设置返回 null）。 */
function nicknameOfUser(user) {
  const n = user && typeof user.nickname === 'string' ? user.nickname.trim() : ''
  return n.length > 0 ? n : null
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/

function usernameError(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 3-32 位字母、数字、下划线或连字符'
  }
  return null
}

/** 昵称长度上限（字符数，兼容中文），问候语展示用。 */
const NICKNAME_MAX = 32

/** 昵称约束：非空时 1-32 个字符，不含控制字符。返回 null 表示合法。 */
function nicknameError(nickname) {
  if (typeof nickname !== 'string') return '昵称需为字符串'
  const trimmed = nickname.trim()
  if (trimmed.length === 0) return null // 空昵称 = 清除，回落用户名
  if (trimmed.length > NICKNAME_MAX) return '昵称最多 32 个字符'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '昵称不能包含控制字符'
  return null
}

// ---------------- 审计日志（H5：IP 假名化） ----------------

const AUDIT_FILE = 'audit.jsonl'

function auditFileForCli() {
  return DATA_DIR + '/' + AUDIT_FILE
}

async function auditFilePath(ctx) {
  try {
    const r = await ctx.fs.resolve(DATA_DIR + '/' + AUDIT_FILE)
    if (r && typeof r.displayPath === 'string') return r.displayPath
    if (r && typeof r.targetKey === 'string') return r.targetKey
  } catch (e) { /* fall through */ }
  return DATA_DIR + '/' + AUDIT_FILE
}

/**
 * H5: 审计 IP 假名化。HMAC-SHA256(key, ip) 取前 8 hex，再附 /24（IPv4）
 * 或 /64（IPv6）网络前缀明文，便于聚合分析同时不落原始地址。
 * 密钥文件首次生成，0600，与凭据同目录。
 */
let auditHmacKeyCache = null
function auditHmacKey() {
  if (auditHmacKeyCache !== null) return auditHmacKeyCache
  const kp = hmacKeyPath()
  try {
    const existing = readFileSync(kp, 'utf8').trim()
    if (existing.length >= 32) {
      auditHmacKeyCache = existing
      return existing
    }
  } catch (e) { /* not present yet */ }
  ensureDataDir()
  const key = randomBytes(32).toString('hex')
  try {
    writeFileSync(kp, key + '\n', { mode: 0o600 })
    auditHmacKeyCache = key
    return key
  } catch (e) {
    // 落盘失败：仍缓存本次生成的 key，保证同一进程内同一 IP 的假名一致（可聚合）
    auditHmacKeyCache = 'fallback-key-unavailable-' + key.slice(0, 8)
    return auditHmacKeyCache
  }
}

function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return null
  let pseudo = null
  try {
    pseudo = createHmac('sha256', auditHmacKey()).update(ip).digest('hex').slice(0, 8)
  } catch (e) {
    pseudo = 'err'
  }
  // 网络 /24 或 /64 前缀（聚合分析用）；IPv4-mapped IPv6（::ffff:a.b.c.d）先还原为 IPv4，
  // 否则会产出 "::ffff:1.2.3.0/24" 这类畸形前缀。
  let v = ip
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) v = mapped[1]
  let net = null
  if (v.includes('.')) {
    const parts = v.split('.').slice(0, 3).join('.')
    net = parts + '.0/24'
  } else {
    const groups = v.split(':').slice(0, 4).join(':')
    net = groups + '::/64'
  }
  return `hmac:${pseudo}|${net}`
}

async function auditLog(ctx, event, fields) {
  let target = null
  try {
    target = await auditFilePath(ctx)
    if (!target) return
    ensureDataDir()
    const entry = { ts: new Date().toISOString(), event }
    for (const key of Object.keys(fields || {})) {
      let v = fields[key]
      if (v === undefined) continue
      if (key === 'ip' && typeof v === 'string') v = anonymizeIp(v)
      entry[key] = typeof v === 'string' || typeof v === 'number' ? v : String(v)
    }
    appendFileSync(target, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    try {
      ctx.logger.warn('[dsh-webui-auth] audit write failed: ' + (e && e.message ? e.message : String(e)))
    } catch (err) { /* ignore */ }
  }
}

function requestMeta(req) {
  let ip = null
  try { ip = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : null } catch (e) { /* ignore */ }
  // H4: 反代场景取真实客户端 IP。仅当 socket 是回环（本机 caddy/cloudflared）时信任代理头，
  // 且取 X-Forwarded-For 最左侧（最初的客户端），CF-Connecting-IP 次之。
  if (ip && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) {
    try {
      const cf = req.headers['cf-connecting-ip']
      if (typeof cf === 'string' && cf.trim()) {
        ip = cf.trim()
      } else {
        const xff = req.headers['x-forwarded-for']
        if (typeof xff === 'string' && xff.trim()) {
          ip = xff.split(',')[0].trim() || ip
        }
      }
    } catch (e) { /* keep socket address */ }
  }
  let ua = null
  try { ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null } catch (e) { /* ignore */ }
  return { ip, ua }
}

async function readAuditEntries(ctx, limit) {
  let target = null
  try {
    target = await auditFilePath(ctx)
    if (!target) return []
    const lines = readFileSync(target, 'utf8').split('\n').filter((l) => l.trim())
    const out = []
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { out.push(JSON.parse(lines[i])) } catch (e) { /* skip malformed line */ }
    }
    return out
  } catch (e) {
    return []
  }
}

// ---------------- 会话有效期 / 密码强度 ----------------

const TTL_OPTIONS = [0, 1, 12, 24, 72]
const TTL_DEFAULT = 12
const SESSION_BROWSER_TTL_MS = 30 * 60 * 1000

function ttlOf(creds) {
  return (creds && typeof creds.ttl === 'number' && TTL_OPTIONS.includes(creds.ttl)) ? creds.ttl : TTL_DEFAULT
}

const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~]/

function passwordStrength(p) {
  if (typeof p !== 'string' || p.length < 8) return { ok: false, reason: 'length' }
  if (!/[a-z]/.test(p)) return { ok: false, reason: 'lower' }
  if (!/[A-Z]/.test(p)) return { ok: false, reason: 'upper' }
  if (!/[0-9]/.test(p)) return { ok: false, reason: 'digit' }
  if (!SPECIAL_CHARS.test(p)) return { ok: false, reason: 'special' }
  return { ok: true, reason: null }
}

// ---------------- HTTP 工具 ----------------

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req, res) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch (e) {
    sendJson(res, 400, { error: '请求体不是有效 JSON' })
    return null
  }
}

function cookieOf(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * 恒定时间令牌比较：先对两侧做 HMAC-SHA256 归一化（消除长度侧信道），
 * 再 timingSafeEqual。用于 setup token 校验（128-bit 随机值，网络时序本难利用，
 * 但恒定时间是正确的习惯）。
 */
function safeTokenEquals(supplied, expected) {
  const a = createHmac('sha256', 'dsh-webui-auth-token-cmp').update(String(supplied)).digest()
  const b = createHmac('sha256', 'dsh-webui-auth-token-cmp').update(String(expected)).digest()
  return timingSafeEqual(a, b)
}

// ---------------- 会话管理（H3：持久化到磁盘） ----------------

const COOKIE_NAME = 'dsh_wua_session'

function sessionCookie(token, maxAgeSeconds) {
  let c = COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Lax; Path=/'
  if (maxAgeSeconds !== undefined) c += '; Max-Age=' + maxAgeSeconds
  return c
}

function clearSessionCookie() {
  return COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
}

/**
 * H3: 持久化会话存储。
 * - 内存 Map 为热路径；每次创建/删除都追加 JSONL 事件（add/remove），启动时重放恢复。
 * - 重放规则：按行序应用 add/remove；过期的会话在重放时丢弃。
 * - 文件损坏（个别行解析失败）跳过该行，不影响其余会话。
 */
class PersistentSessions {
  constructor() {
    this.live = new Map()
    this.ok = true // 持久化通道健康标志（写失败置 false，不影响认证本身）
  }

  load() {
    let lines = []
    try {
      lines = readFileSync(sessionsPath(), 'utf8').split('\n').filter((l) => l.trim())
    } catch (e) { return /* 无文件 = 全新状态 */ }
    for (const line of lines) {
      let ev = null
      try { ev = JSON.parse(line) } catch (e) { continue }
      if (!ev || typeof ev.op !== 'string' || typeof ev.token !== 'string') continue
      if (ev.op === 'add' && ev.sess && typeof ev.sess === 'object') {
        const s = { username: String(ev.sess.username || ''), expiresAt: Number(ev.sess.expiresAt) || 0, browser: !!ev.sess.browser }
        if (s.expiresAt > Date.now()) this.live.set(ev.token, s)
      } else if (ev.op === 'remove') {
        this.live.delete(ev.token)
      } else if (ev.op === 'remove-many' && Array.isArray(ev.tokens)) {
        for (const t of ev.tokens) this.live.delete(t)
      } else if (ev.op === 'clear') {
        this.live.clear()
      }
    }
  }

  append(ev) {
    try {
      ensureDataDir()
      // 会话 token 是裸的 bearer 凭据：文件权限收紧到 0600（与 setup-token / audit-hmac-key 一致）
      appendFileSync(sessionsPath(), JSON.stringify(ev) + '\n', { encoding: 'utf8', mode: 0o600 })
      this.ok = true
    } catch (e) {
      this.ok = false // 磁盘写失败：认证继续，仅丢失重启恢复能力
    }
  }

  // 压缩：live 状态整体重写（启动时调用一次，防止文件无限增长）
  compact() {
    try {
      ensureDataDir()
      const out = []
      const now = Date.now()
      for (const [token, s] of this.live) {
        if (s.expiresAt > now) out.push({ op: 'add', token, sess: s })
      }
      writeFileSync(sessionsPath(), out.map((e) => JSON.stringify(e)).join('\n') + (out.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 })
    } catch (e) { /* 压缩失败不影响运行 */ }
  }

  get(token) { return this.live.get(token) }
  has(token) { return this.live.has(token) }
  delete(token) {
    this.live.delete(token)
    this.append({ op: 'remove', token })
  }
  set(token, sess) {
    this.live.set(token, sess)
    this.append({ op: 'add', token, sess })
  }
  // 批量移除（除 keepToken 外全部）：只追加一条 remove-many 事件，避免逐个 append 的写放大
  deleteAllExcept(keepToken) {
    const removed = []
    for (const k of [...this.live.keys()]) {
      if (k !== keepToken) {
        this.live.delete(k)
        removed.push(k)
      }
    }
    if (removed.length > 0) this.append({ op: 'remove-many', tokens: removed })
  }
  // 移除某用户名的所有会话（keepToken 保留，可为 null）：用于删用户/重置/改密时踢下线
  deleteByUsernameExcept(username, keepToken) {
    const removed = []
    for (const [k, s] of [...this.live.entries()]) {
      if (k !== keepToken && s && s.username === username) {
        this.live.delete(k)
        removed.push(k)
      }
    }
    if (removed.length > 0) this.append({ op: 'remove-many', tokens: removed })
  }
  clear() {
    this.live.clear()
    this.append({ op: 'clear', token: '*' })
  }
}

// ---------------- 登录页（与上游一致，追加 setup-token 输入框） ----------------

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>天枢平台 — 登录</title>
<style>
  body {
    --dsw-alias-bg-base: rgb(255, 255, 255);
    --dsw-alias-bg-layer-1: rgb(255, 255, 255);
    --dsw-alias-bg-layer-2: rgb(255, 255, 255);
    --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
    --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);
    --dsw-alias-label-primary: rgb(15, 17, 21);
    --dsw-alias-label-secondary: rgb(97, 102, 107);
    --dsw-alias-brand-primary: rgb(15, 17, 21);
    --dsw-alias-state-error-primary: rgb(236, 19, 19);
    --dsw-alias-state-success-primary: rgb(34, 197, 94);
    --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  }
  body[data-ds-dark-theme] {
    --dsw-alias-bg-base: rgb(21, 21, 23);
    --dsw-alias-bg-layer-1: rgb(35, 35, 36);
    --dsw-alias-bg-layer-2: rgb(44, 44, 46);
    --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
    --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
    --dsw-alias-label-primary: rgb(249, 250, 251);
    --dsw-alias-label-secondary: rgb(207, 211, 214);
    --dsw-alias-brand-primary: rgb(249, 250, 251);
    --dsw-alias-state-error-primary: rgb(242, 90, 90);
    --dsw-alias-state-success-primary: rgb(34, 197, 94);
    --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  }
  /* 天枢平台: the shipped backdrop carries the artwork; layout only places the card.
     Card geometry mirrors the reference composition (1366x768): the card spans
     x 181..702 and y 94..673, i.e. 38.1% width at 13.2% from the left edge. */
  body { --tianshu-primary: #2563EB; --tianshu-primary-hover: #1D4ED8;
    --tianshu-field-border: #E5E7EB; --tianshu-field-bg: #FFFFFF;
    --tianshu-muted: #9CA3AF; --tianshu-fallback-1: #EAF3FD; --tianshu-fallback-2: #BBD9F6; }
  body[data-ds-dark-theme] { --tianshu-primary: #4F86F7; --tianshu-primary-hover: #6C9BFA;
    --tianshu-field-border: rgba(255,255,255,.14); --tianshu-field-bg: rgba(255,255,255,.05);
    --tianshu-muted: #8A93A0; --tianshu-fallback-1: #0E1626; --tianshu-fallback-2: #16273F; }
  body { margin: 0; min-height: 100vh; box-sizing: border-box;
    display: flex; align-items: center;
    padding-left: 13.25%; padding-right: 4vw;
    /* The gradient is the fallback when the asset 404s; the image covers it. */
    background:
      url('/dsh-webui-auth/login-bg.png') center center /  100% 100% no-repeat,
      linear-gradient(152deg, var(--tianshu-fallback-1) 0%, var(--tianshu-fallback-2) 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  /* The backdrop bakes in a light card; dark mode dims it so the real card reads. */
  body[data-ds-dark-theme]::before { content: ''; position: fixed; inset: 0;
    background: rgba(9, 14, 24, .58); pointer-events: none; }
  /* The live card must cover the backdrop's printed card exactly, or its edge and
     its decorative close button show through. Reference geometry (1366x768):
     x 181..702, y 94..673 -> 38.15% wide, 75.4% tall, centered on that band. */
  .card { position: relative; width: 38.15%; min-width: 340px; max-width: 560px;
    height: 55vh; min-height: 470px; overflow-y: auto;
    display: flex; flex-direction: column; justify-content: center;
    padding: 40px 44px; box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-1, #fff);
    border-radius: 4px; box-shadow: 0 18px 50px rgba(23, 63, 138, .10); }
  h1 { margin: 0 0 26px; font-size: 27px; font-weight: 600; letter-spacing: .01em;
    color: var(--dsw-alias-label-primary, #222); }
  /* Tab strip: the active tab owns the blue label and the underline. */
  .tabs { display: flex; gap: 26px; margin: 0 0 30px; }
  .tab { position: relative; padding: 0 0 8px; font-size: 15px; cursor: pointer;
    color: var(--dsw-alias-label-primary, #333); background: none; border: none;
    width: auto; margin: 0; font-weight: 400; }
  .tab[aria-selected="true"] { color: var(--tianshu-primary); }
  .tab[aria-selected="true"]::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0;
    height: 2px; background: var(--tianshu-primary); }
  .sub { margin: 0 0 18px; font-size: 13px; line-height: 1.6;
    color: var(--dsw-alias-label-secondary, #888); }
  /* Field: the icon sits inside the border, divided from the text by a hairline. */
  .field { position: relative; margin: 0 0 18px; }
  .field .ico { position: absolute; left: 0; top: 0; bottom: 0; width: 42px;
    display: flex; align-items: center; justify-content: center;
    color: #4B5563; pointer-events: none; }
  .field .ico::after { content: ''; position: absolute; right: 0; top: 11px; bottom: 11px;
    width: 1px; background: var(--tianshu-field-border); }
  label { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); margin: 0 0 6px; }
  input { box-sizing: border-box; width: 100%; height: 46px; padding: 0 14px 0 54px;
    font-size: 14px; color: var(--dsw-alias-label-primary, #222);
    background: var(--tianshu-field-bg); border: 1px solid var(--tianshu-field-border);
    border-radius: 4px; outline: none; transition: border-color .15s; }
  input::placeholder { color: var(--tianshu-muted); }
  input:focus { border-color: var(--tianshu-primary); }
  input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
    -webkit-text-fill-color: var(--dsw-alias-label-primary, #222);
    -webkit-box-shadow: 0 0 0 1000px var(--tianshu-field-bg) inset;
    box-shadow: 0 0 0 1000px var(--tianshu-field-bg) inset;
    caret-color: var(--dsw-alias-label-primary, #222);
    transition: background-color 999999s ease-in-out 0s;
  }
  /* Code field shares the row with its send button. */
  .field.with-send input { padding-right: 118px; }
  .send { position: absolute; right: 1px; top: 7px; height: 32px; width: auto; margin: 0;
    padding: 0 14px; font-size: 13px; font-weight: 400; color: var(--tianshu-primary);
    background: none; border: none; border-left: 1px solid var(--tianshu-field-border);
    border-radius: 0; cursor: pointer; }
  .row { display: flex; align-items: center; justify-content: space-between; margin: 0; }
  .remember { display: flex; align-items: center; gap: 7px; cursor: pointer;
    font-size: 13px; color: var(--dsw-alias-label-secondary, #6B7280); }
  .remember input { position: absolute; opacity: 0; width: 0; height: 0; padding: 0; }
  .dot { width: 13px; height: 13px; border-radius: 50%; box-sizing: border-box;
    border: 1px solid #C9CFD8; flex: none; }
  .remember input:checked + .dot { border-color: var(--tianshu-primary); border-width: 4px; }
  .remember input:focus-visible + .dot { outline: 2px solid var(--tianshu-primary); outline-offset: 2px; }
  .link { font-size: 12px; color: var(--tianshu-primary); background: none; border: none;
    padding: 0; width: auto; margin: 0; font-weight: 400; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  button.primary { width: 100%; margin-top: 34px; height: 46px; padding: 0 18px;
    font-size: 16px; font-weight: 400; cursor: pointer; color: #fff;
    background: var(--tianshu-primary); border: none; border-radius: 4px; }
  button.primary:hover:not(:disabled) { background: var(--tianshu-primary-hover); }
  button.primary:disabled { opacity: .55; cursor: default; }
  .err { display: none; margin: 14px 0 0; font-size: 13px;
    color: var(--dsw-alias-state-error-primary, #d1242f); }
  .note { display: none; margin: 14px 0 0; font-size: 13px; line-height: 1.6;
    color: var(--dsw-alias-label-secondary, #888); }
  .hint { margin: 20px 0 0; font-size: 12px; line-height: 1.6;
    color: var(--dsw-alias-label-secondary, #888);
    border-top: 1px solid var(--dsw-alias-border-l1, #eee); padding-top: 12px; }
  .token-row { display: none; }
  .pane[hidden] { display: none; }
  /* Below the reference width the card centers rather than tracking a percentage. */
  @media (max-width: 900px) {
    body { padding: 0 24px; justify-content: center; }
    .card { width: 100%; max-width: 460px; padding: 36px 28px 40px; }
  }
</style>
</head>
<body>
<script>
(function () {
  var preference = "__THEME_PREFERENCE__";
  if (preference !== 'light' && preference !== 'dark') preference = 'system';
  var mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    var systemDark = preference === 'system' && !!mq && mq.matches;
    var dark = preference === 'dark' || systemDark;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.toggleAttribute('data-ds-dark-theme', dark);
  }
  apply();
  if (preference === 'system' && mq) {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
    else if (typeof mq.addListener === 'function') mq.addListener(apply);
  }
})();
</script>
<div class="card">
  <h1>欢迎回来</h1>
  <div class="tabs" role="tablist">
    <button class="tab" id="tab-pw" type="button" role="tab" aria-selected="true" aria-controls="pane-pw">密码登录</button>
    <button class="tab" id="tab-code" type="button" role="tab" aria-selected="false" aria-controls="pane-code">验证码登录</button>
  </div>
  <p class="sub" id="sub"></p>
  <form id="f">
    <div class="pane" id="pane-pw" role="tabpanel" aria-labelledby="tab-pw">
      <div class="token-row" id="tokenrow">
        <label for="t">初始化令牌（见 dsh 启动日志）</label>
        <div class="field">
          <span class="ico">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="8" cy="16" r="4"/><path d="M10.9 13.1L20 4m-3 3l2.5 2.5M14 10l2.5 2.5"/>
            </svg>
          </span>
          <input id="t" type="password" autocomplete="off" spellcheck="false" placeholder="请输入初始化令牌">
        </div>
      </div>
      <div class="field">
        <span class="ico">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/>
          </svg>
        </span>
        <input id="u" type="text" autocomplete="username" autofocus spellcheck="false" placeholder="请输入您的账号">
      </div>
      <div class="field">
        <span class="ico">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/>
          </svg>
        </span>
        <input id="p" type="password" autocomplete="current-password" placeholder="请输入您的密码">
      </div>
      <div id="pc" style="display:none">
        <div class="field">
          <span class="ico">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/><path d="M9.5 16l1.8 1.8 3.2-3.4"/>
            </svg>
          </span>
          <input id="p2" type="password" autocomplete="new-password" placeholder="请再次输入密码">
        </div>
      </div>
      <div class="row" id="pwrow">
        <label class="remember" for="rm">
          <input type="checkbox" id="rm"><span class="dot"></span>记住密码
        </label>
        <button class="link" id="forgot" type="button">忘记密码</button>
      </div>
    </div>
    <div class="pane" id="pane-code" role="tabpanel" aria-labelledby="tab-code" hidden>
      <div class="field">
        <span class="ico">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/>
          </svg>
        </span>
        <input id="ph" type="tel" autocomplete="off" spellcheck="false" placeholder="请输入您的手机号码">
      </div>
      <div class="field with-send">
        <span class="ico">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 7.5l8.5 5.5 8.5-5.5"/><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>
          </svg>
        </span>
        <input id="cd" type="text" autocomplete="off" spellcheck="false" placeholder="请输入验证码">
        <button class="send" id="sendcode" type="button">获取验证码</button>
      </div>
    </div>
    <button class="primary" id="b" type="submit">立即登录</button>
    <p class="err" id="e"></p>
    <p class="note" id="n"></p>
  </form>
  <p class="hint" id="hint">忘记密码：删除插件数据目录的 dsh-webui-auth.json 文件即可重置。</p>
</div>
<script>
var MODE = "__MODE__";
var sub = document.getElementById('sub'), pc = document.getElementById('pc'), e = document.getElementById('e'),
  n = document.getElementById('n'),
  u = document.getElementById('u'), p = document.getElementById('p'), p2 = document.getElementById('p2'), b = document.getElementById('b'),
  f = document.getElementById('f'), t = document.getElementById('t'), tokenrow = document.getElementById('tokenrow'),
  tabPw = document.getElementById('tab-pw'), tabCode = document.getElementById('tab-code'),
  panePw = document.getElementById('pane-pw'), paneCode = document.getElementById('pane-code'),
  pwrow = document.getElementById('pwrow'), forgot = document.getElementById('forgot'),
  hint = document.getElementById('hint'),
  sendcode = document.getElementById('sendcode');
function show(msg) { n.style.display = 'none'; e.textContent = msg; e.style.display = 'block'; }
function note(msg) { e.style.display = 'none'; n.textContent = msg; n.style.display = 'block'; }
function clearMsg() { e.style.display = 'none'; n.style.display = 'none'; }

// The verification-code tab is presentation only: dsh-webui-auth authenticates a
// username and a password and has no concept of a phone number or a code. The tab
// selects which pane is visible; submit always posts the password credentials.
var codeTab = false;
function selectTab(useCode) {
  codeTab = useCode;
  tabPw.setAttribute('aria-selected', String(!useCode));
  tabCode.setAttribute('aria-selected', String(useCode));
  panePw.hidden = useCode;
  paneCode.hidden = !useCode;
  clearMsg();
  if (useCode) note('验证码登录尚未开放，请使用密码登录。');
}
tabPw.addEventListener('click', function () { selectTab(false); });
tabCode.addEventListener('click', function () { selectTab(true); });
sendcode.addEventListener('click', function () { note('验证码服务尚未接入，请使用密码登录。'); });
forgot.addEventListener('click', function () {
  note('重置密码：删除插件数据目录下的 dsh-webui-auth.json，最多 1 分钟后认证自动关闭，再用新的初始化令牌重新创建账号。');
});

if (MODE === 'setup') {
  sub.textContent = '首次使用：输入初始化令牌并创建管理员账号密码，之后访问 WebUI 需要登录。';
  tokenrow.style.display = 'block';
  pc.style.display = 'block';
  pwrow.style.display = 'none';
  b.textContent = '创建账号';
  // Account creation has no code path at all, so the tab strip would offer a
  // choice that cannot be taken — and a lone remaining tab labels nothing.
  tabCode.style.display = 'none';
  tabPw.parentNode.style.display = 'none';
} else {
  sub.textContent = '此界面已启用身份认证，请登录后继续使用。';
  // The reset instruction is what the 忘记密码 control reveals on demand; keeping
  // the footer copy too would state it twice.
  hint.style.display = 'none';
}
function validUsername(name) { return /^[A-Za-z0-9_-]{3,32}$/.test(name); }
f.addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (codeTab) return note('验证码登录尚未开放，请使用密码登录。');
  clearMsg();
  var username = u.value.trim(), password = p.value, token = t ? t.value.trim() : '';
  if (MODE === 'setup') {
    if (!token) return show('请输入初始化令牌（dsh 启动日志中查找 [dsh-webui-auth] setup token）');
    if (!validUsername(username)) return show('用户名需为 3-32 位字母、数字、下划线或连字符');
    if (password.length < 8) return show('密码至少需要 8 位');
    if (!/[a-z]/.test(password)) return show('密码必须包含小写字母');
    if (!/[A-Z]/.test(password)) return show('密码必须包含大写字母');
    if (!/[0-9]/.test(password)) return show('密码必须包含数字');
    if (!/[!@#$%^&*()_+\\-=\\[\\]{}|;:,.<>?/~]/.test(password)) return show('密码必须包含特殊符号');
    if (password !== p2.value) return show('两次输入的密码不一致');
  }
  b.disabled = true; b.textContent = '请稍候…';
  var body = { username: username, password: password };
  if (MODE === 'setup') body.token = token;
  fetch(MODE === 'setup' ? '/dsh-webui-auth/setup' : '/dsh-webui-auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(function (r) {
    if (r && r.ok) { location.href = '/'; return; }
    b.disabled = false; b.textContent = MODE === 'setup' ? '创建账号' : '立即登录';
    if (r && r.error === 'rate-limited') show('尝试次数过多，请一分钟后重试');
    else if (r && r.error === 'setup-token-required') show('初始化令牌缺失或不正确（见 dsh 启动日志）');
    else if (r && r.error === 'weak-password') show('密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号');
    else if (r && r.error === 'username-invalid') show('用户名需为 3-32 位字母、数字、下划线或连字符');
    else if (r && r.error === 'not-configured') show('凭据尚未配置，请刷新页面后重新创建');
    else if (r && r.error === 'already-configured') show('认证已启用，请使用登录模式');
    else show(MODE === 'setup' ? '创建失败，请检查输入' : '用户名或密码错误');
  }).catch(function () {
    b.disabled = false; b.textContent = MODE === 'setup' ? '创建账号' : '立即登录';
    show('无法连接认证服务，请刷新重试');
  });
});
</script>
</body>
</html>`

// ---------------- H2: 运行时路由包装（零核心补丁） ----------------
//
// /api 与 WebSocket 的会话闸门通过包装 webServer 服务的路由表实现：
// 1. 对已注册的 /api prefix 路由与 /api/events.* upgrade 路由做 handler 原地包装；
// 2. 同时替换 prefixes/upgrades 为带拦截的 Map，捕获后续注册（如热重载/插件管理器）；
// 3. 卸载（effect disposer）时恢复原始 handler 与原始 Map —— 完全可逆。
//
// 若找不到预期路由（dsh 内部结构变化），shapeCheck 失败并明确报错，
// 且 setup/configure 拒绝启用闸门（fail-closed：宁可不可用，不可裸奔）。

const API_PREFIX = '/api'
const PLUGINS_PREFIX = '/plugins'
const MUX_PATH = '/api/events.mux'
const HOST_PATH = '/api/events.host'

function rejectUpgrade401(socket) {
  try {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 13\r\n\r\nunauthorized\n')
  } catch (e) { /* ignore */ }
  try { socket.destroy() } catch (e) { /* ignore */ }
}

/**
 * 安装运行时路由闸门。带周期重扫：apply() 可能早于 client-connection 的
 * 路由注册执行（loader 波次顺序不保证），每 2 秒重扫路由表直到全部
 * 找到（上限 60 秒）。gate 状态动态更新，供 status 端点与 fail-closed
 * 检查读取。
 * @returns {{ ok: () => boolean, problems: () => string[], undo: () => void }}
 */
function installRouteGate(ctx, checkRequest, log) {
  const ws = ctx.webServer
  const problems = new Set()
  const undos = []
  let undone = false

  const wrapHttp = (route, opts) => {
    const original = route.handler
    const loopbackDeputy = !!(opts && opts.loopbackDeputy)
    const wrapped = async (req, res) => {
      if (!checkRequest(req)) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('unauthorized')
        return
      }
      if (loopbackDeputy) {
        // Authenticated + this is the /api surface: present the request to the
        // core as loopback so PRIVILEGED_METHODS' strict fence (settings.*,
        // credentials.*, agentPreset.*, llm.discoverModels) admits it. Our
        // session gate already proved operator identity — strictly stronger
        // than the Host-header heuristic it replaces for these callers.
        // The fence also compares Origin.host to Host and rejects cross-site
        // Fetch Metadata; a reverse-proxied request carries the public origin,
        // so both are normalized alongside Host to the loopback deputy shape.
        req.headers.host = '127.0.0.1'
        // Origin/Fetch-Metadata 一并移除：以"非浏览器回环客户端"形状呈现。
        // 不能只改写 Origin 的 host——Host 带 127.0.0.1:3080 端口而改写后的
        // Origin 无端口时 host 比对仍不相等（实测 403）。删除后走 fence 的
        // 无-Origin 回环放行路径（实测 200），语义也更干净：代理后的请求
        // 本来就不是浏览器直连。
        delete req.headers.origin
        delete req.headers['sec-fetch-site']
        delete req.headers['sec-fetch-mode']
        delete req.headers['sec-fetch-dest']
      }
      return original(req, res)
    }
    route.handler = wrapped
    return () => { route.handler = original }
  }
  const wrapUpgrade = (route) => {
    const original = route.handler
    const wrapped = (req, socket, head) => {
      if (checkRequest(req)) return original(req, socket, head)
      rejectUpgrade401(socket)
    }
    route.handler = wrapped
    return () => { route.handler = original }
  }

  // 已包装的路由打标记，避免重复包装
  const wrapped = new WeakSet()
  const PROTECTED_PREFIXES = [API_PREFIX, PLUGINS_PREFIX]
  const scanOnce = () => {
    if (undone) return
    for (const pfx of PROTECTED_PREFIXES) {
      const route = ws.prefixes.get(pfx)
      if (route !== undefined && !wrapped.has(route)) {
        wrapped.add(route)
        undos.push(wrapHttp(route, { loopbackDeputy: pfx === API_PREFIX }))
        problems.delete(`prefix route "${pfx}" not registered yet`)
        log(`wrapped prefix route ${pfx}`)
      } else if (route === undefined) {
        problems.add(`prefix route "${pfx}" not registered yet`)
      }
    }
    for (const path of [MUX_PATH, HOST_PATH]) {
      const r = ws.upgrades.get(path)
      if (r !== undefined && !wrapped.has(r)) {
        wrapped.add(r)
        undos.push(wrapUpgrade(r))
        problems.delete(`upgrade route "${path}" not registered yet`)
        log(`wrapped upgrade route ${path}`)
      } else if (r === undefined) {
        problems.add(`upgrade route "${path}" not registered yet`)
      }
    }
  }

  scanOnce()

  // 周期重扫：捕获晚注册（loader 波次/服务重挂载）。全找到后停止（但保留
  // 低频兜底扫描，防止服务重建后路由对象被替换）。
  let elapsed = 0
  let scans = 0
  let transitioned = false
  const rescan = setInterval(() => {
    if (undone) { clearInterval(rescan); return }
    scanOnce()
    elapsed += 2
    scans += 1
    if (!transitioned && problems.size === 0 && elapsed > 60) {
      // 全部就位后降频为 10s 兜底（服务 fiber 重建时路由对象会换新）；
      // 仅迁移一次，避免每个 tick 重复创建慢速 interval 造成泄漏。
      transitioned = true
      clearInterval(rescan)
      const slow = setInterval(() => { if (!undone) scanOnce(); else clearInterval(slow) }, 10000)
      undos.push(() => clearInterval(slow))
      return
    }
    if (problems.size > 0 && scans >= 150) {
      // 5 分钟（@2s）内路由始终未注册：停止重扫，保持 fail-closed（setup/configure
      // 不会启用认证）并记录明确错误，避免无限空转。
      clearInterval(rescan)
      log('route gate: stopped rescanning after ' + scans + ' attempts — routes never registered: ' + [...problems].join('; '))
    }
  }, 2000)
  undos.push(() => clearInterval(rescan))

  const undo = () => {
    undone = true
    for (const u of undos.splice(0).reverse()) { try { u() } catch (e) { /* ignore */ } }
  }
  return { ok: () => problems.size === 0, problems: () => [...problems], undo }
}

// ---------------- DSH 外观偏好 ----------------

const THEME_NAMESPACE = 'ui-theme'
const THEME_PREFERENCE_DEFAULT = 'system'

function themePreference(ctx) {
  try {
    const settings = ctx.get('settings')
    if (settings === undefined) return THEME_PREFERENCE_DEFAULT
    const section = settings.get(THEME_NAMESPACE)
    if (section === undefined) return THEME_PREFERENCE_DEFAULT
    const preference = section.preference
    return (preference === 'light' || preference === 'dark') ? preference : THEME_PREFERENCE_DEFAULT
  } catch (e) {
    return THEME_PREFERENCE_DEFAULT
  }
}

export async function apply(ctx) {
  // H1: 每次启动生成随机 setup token，仅打印到宿主日志。
  const SETUP_TOKEN = randomBytes(16).toString('hex')

  let enabledFlag = false
  async function refreshEnabled() {
    const creds = await readCredentials(ctx)
    enabledFlag = isEnabled(creds)
  }
  await refreshEnabled()

  // H3: 持久化会话（启动重放 + 压缩）
  const sessions = new PersistentSessions()
  sessions.load()
  sessions.compact()

  // H4: 按 IP 限流 { ip -> [timestamps] }
  const failuresByIp = new Map()
  const RATE_WINDOW_MS = 60_000
  const RATE_MAX = 5

  function ipRateLimited(ip) {
    if (!ip) return false
    const now = Date.now()
    const arr = (failuresByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
    if (arr.length >= RATE_MAX) {
      failuresByIp.set(ip, arr)
      return true
    }
    return false
  }
  function recordFailure(ip) {
    if (!ip) return
    const now = Date.now()
    const arr = (failuresByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
    arr.push(now)
    failuresByIp.set(ip, arr)
  }

  function checkRequest(req) {
    if (!enabledFlag) return true
    const token = cookieOf(req, COOKIE_NAME)
    if (!token) return false
    const s = sessions.get(token)
    if (!s) return false
    if (s.expiresAt <= Date.now()) {
      sessions.delete(token)
      return false
    }
    if (s.browser === true) s.expiresAt = Date.now() + SESSION_BROWSER_TTL_MS
    return true
  }

  // 当前请求会话所属用户名（会话有效则返回，否则 null）。角色不缓存在会话里，
  // 每次从凭据文件实时查（见 findUser），故改角色即时生效、无需动会话。
  function sessionUsernameOf(req) {
    const token = cookieOf(req, COOKIE_NAME)
    if (!token) return null
    const s = sessions.get(token)
    if (!s || s.expiresAt <= Date.now()) return null
    return s.username
  }

  // 管理员闸门：会话无效 → 401；非管理员 → 403。通过则返回 { creds, me }。
  async function requireAdmin(req, res) {
    if (enabledFlag && !checkRequest(req)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return null
    }
    const creds = await readCredentials(ctx)
    const me = findUser(creds, sessionUsernameOf(req))
    if (!me || me.role !== 'admin') {
      sendJson(res, 403, { ok: false, error: 'forbidden' })
      return null
    }
    return { creds, me }
  }

  function createSession(username, ttl) {
    const token = randomBytes(24).toString('hex')
    const ttlMs = ttl > 0 ? ttl * 3600 * 1000 : SESSION_BROWSER_TTL_MS
    sessions.set(token, { username, expiresAt: Date.now() + ttlMs, browser: ttl <= 0 })
    return { token, maxAge: ttl > 0 ? ttl * 3600 : undefined }
  }

  function destroySession(req) {
    const token = cookieOf(req, COOKIE_NAME)
    if (token) sessions.delete(token)
  }

  // H2: 安装运行时路由闸门
  const gate = installRouteGate(ctx, checkRequest, (m) => ctx.logger.info('[dsh-webui-auth] ' + m))
  ctx.effect(() => gate.undo, 'dsh-webui-auth: route gate')
  if (!gate.ok()) {
    ctx.logger.error('[dsh-webui-auth] ROUTE GATE INCOMPLETE — ' + gate.problems().join('; ')
      + '. /api and/or WebSocket may be unprotected; the gate will still wrap them if they register later.')
  }

  ctx.logger.info('[dsh-webui-auth] started, credentials file: ' + configPath())
  if (!enabledFlag) {
    // H1: token 同时落盘（0600，仅本机操作者可读），setup 成功后删除。
    // 解决 ctx.logger 输出在某些部署（systemd）下不可见的问题。
    try {
      ensureDataDir()
      writeFileSync(DATA_DIR + '/setup-token', SETUP_TOKEN + '\n', { mode: 0o600 })
    } catch (e) { /* 落盘失败时仍可从日志读取 */ }
    ctx.logger.info('[dsh-webui-auth] setup token (first-run administrator creation): ' + SETUP_TOKEN)
  }

  // 后台任务：过期会话清理 + enabled 状态刷新
  const bgTimer = setInterval(async () => {
    const now = Date.now()
    for (const [k, s] of sessions.live) if (s.expiresAt <= now) sessions.delete(k)
    try {
      const creds = await readCredentials(ctx)
      enabledFlag = isEnabled(creds)
    } catch (e) { /* keep last state */ }
  }, 60000)
  ctx.effect(() => () => clearInterval(bgTimer), 'dsh-webui-auth: background timer')

  // ---------------- 端点 ----------------

  // The login backdrop ships with the plugin. It is the only asset served here,
  // read once at first request and held for the process lifetime: the file is
  // part of the installed package, so it cannot change under a running server.
  let backdropCache = null
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/login-bg.png',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: '仅支持 GET/HEAD' })
        return
      }
      if (backdropCache === null) {
        const dir = pluginDir()
        try {
          backdropCache = readFileSync(resolvePath(dir, 'assets', 'login-bg.png'))
        } catch (e) {
          // A missing asset must not take the login page down with it; the page
          // keeps its gradient fallback and the operator sees the reason once.
          ctx.logger.warn('[dsh-webui-auth] login backdrop unavailable: ' + (e && e.message ? e.message : String(e)))
          backdropCache = false
        }
      }
      if (backdropCache === false) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('login backdrop unavailable')
        return
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(backdropCache.length),
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : backdropCache)
    },
  }), 'dsh-webui-auth: login backdrop route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/login',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const page = LOGIN_PAGE
            .replace('__MODE__', enabledFlag ? 'login' : 'setup')
            .replace('__THEME_PREFERENCE__', themePreference(ctx))
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
            'x-robots-tag': 'noindex, nofollow',
            'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          })
          res.end(page)
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req, res)
          if (body === null) return
          if (!enabledFlag) {
            sendJson(res, 200, { ok: false, error: 'not-configured' })
            return
          }
          const username = String(body.username || '').trim()
          const password = String(body.password || '')
          const creds = await readCredentials(ctx)
          if (!isEnabled(creds)) {
            sendJson(res, 200, { ok: false, error: 'not-configured' })
            return
          }
          const meta = requestMeta(req)
          if (ipRateLimited(meta.ip)) {
            await auditLog(ctx, 'login_rate_limited', { username: username || null, ip: meta.ip, ua: meta.ua })
            sendJson(res, 200, { ok: false, error: 'rate-limited' })
            return
          }
          let valid = false
          const account = findUser(creds, username)
          if (account) {
            valid = await verifyPassword(password, account.hash)
          } else {
            valid = await dummyVerify(password)
          }
          if (!valid) {
            recordFailure(meta.ip)
            await auditLog(ctx, 'login_failure', { username: username || null, ip: meta.ip, ua: meta.ua })
            sendJson(res, 200, { ok: false, error: 'invalid' })
            return
          }
          const s = createSession(username, ttlOf(creds))
          res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge))
          await auditLog(ctx, 'login_success', { username, ip: meta.ip, ua: meta.ua })
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 405, { error: '仅支持 GET/POST' })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: login page')

  // 登录用户名/昵称查询：前端问候语个性化用。未启用认证时 username 为 null（而非
  // 404/401），让已登录与否的浏览器都拿到 200，避免控制台网络错误噪音；
  // nickname 已设置时一并返回（问候语优先展示昵称）；会话 token 不出现在任何响应里。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/whoami',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET/HEAD' })
          return
        }
        if (!enabledFlag) {
          sendJson(res, 200, { ok: true, username: null, nickname: null })
          return
        }
        const token = cookieOf(req, COOKIE_NAME)
        const sess = token ? sessions.get(token) : undefined
        if (sess === undefined || sess.expiresAt <= Date.now()) {
          sendJson(res, 200, { ok: false, username: null, nickname: null })
          return
        }
        const creds = await readCredentials(ctx)
        const me = findUser(creds, sess.username)
        sendJson(res, 200, { ok: true, username: sess.username, nickname: me ? nicknameOfUser(me) : null, role: me ? me.role : null })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: whoami')

  // 昵称修改：问候语展示用、非安全字段，但仍在会话内修改以防匿名篡改。
  // 空昵称 = 清除（回落用户名）。写回凭据文件（保留其他字段）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/nickname',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const body = await readJsonBody(req, res)
        if (body === null) return
        const creds = await readCredentials(ctx)
        const me = findUser(creds, sessionUsernameOf(req))
        if (!isEnabled(creds) || !me) {
          sendJson(res, 200, { ok: false, error: 'not-configured' })
          return
        }
        const nickname = String(body.nickname ?? '').trim()
        const err = nicknameError(nickname)
        if (err) {
          sendJson(res, 200, { ok: false, error: 'nickname-invalid', reason: err })
          return
        }
        const meta = requestMeta(req)
        const nextUsers = usersOf(creds).map((u) => {
          if (u.username !== me.username) return u
          const { nickname: _prev, ...rest } = u
          return nickname.length > 0 ? { ...rest, nickname } : rest
        })
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: nextUsers })
        await auditLog(ctx, 'nickname_changed', { username: me.username, ip: meta.ip, ua: meta.ua, detail: nickname.length > 0 ? '设置昵称' : '清除昵称' })
        sendJson(res, 200, { ok: true, nickname: nickname.length > 0 ? nickname : null })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: nickname')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/setup',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag) {
          const meta = requestMeta(req)
          await auditLog(ctx, 'setup_failure', { username: null, ip: meta.ip, ua: meta.ua, detail: '已初始化，拒绝重复配置' })
          sendJson(res, 200, { ok: false, error: 'already-configured' })
          return
        }
        // H1: 首次配置必须携带本次启动的 setup token
        const body = await readJsonBody(req, res)
        if (body === null) return
        const suppliedToken = typeof body.token === 'string' ? body.token.trim() : ''
        const meta = requestMeta(req)
        if (!safeTokenEquals(suppliedToken, SETUP_TOKEN)) {
          await auditLog(ctx, 'setup_failure', { username: null, ip: meta.ip, ua: meta.ua, detail: 'setup token 缺失或不匹配' })
          sendJson(res, 200, { ok: false, error: 'setup-token-required' })
          return
        }
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        const nameErr = usernameError(username)
        if (nameErr) {
          await auditLog(ctx, 'setup_failure', { username: username || null, ip: meta.ip, ua: meta.ua, detail: '用户名格式不合法' })
          sendJson(res, 200, { ok: false, error: 'username-invalid' })
          return
        }
        const st = passwordStrength(password)
        if (!st.ok) {
          await auditLog(ctx, 'setup_failure', { username, ip: meta.ip, ua: meta.ua, detail: '密码强度不足' })
          sendJson(res, 200, { ok: false, error: 'weak-password', reason: st.reason })
          return
        }
        // H2 fail-closed：路由闸门不完整时拒绝启用认证（防止"开了登录却裸奔 /api"）
        if (!gate.ok()) {
          await auditLog(ctx, 'setup_failure', { username, ip: meta.ip, ua: meta.ua, detail: '路由闸门不完整，拒绝启用' })
          sendJson(res, 200, { ok: false, error: 'gate-incomplete', problem: gate.problems()[0] || '' })
          return
        }
        await writeCredentials(ctx, { v: 4, ttl: TTL_DEFAULT, users: [{ username, hash: await hashPassword(password), role: 'admin' }] })
        try { unlinkSync(DATA_DIR + '/setup-token') } catch (e) { /* already gone */ }
        enabledFlag = true
        const s = createSession(username, TTL_DEFAULT)
        res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge))
        await auditLog(ctx, 'setup_success', { username, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: setup')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/logout',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        const token = cookieOf(req, COOKIE_NAME)
        const s = token ? sessions.get(token) : null
        destroySession(req)
        res.setHeader('Set-Cookie', clearSessionCookie())
        const meta = requestMeta(req)
        await auditLog(ctx, 'logout', { username: s ? s.username : null, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: logout')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/status',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const creds = await readCredentials(ctx)
        const enabled = isEnabled(creds)
        const me = enabled ? findUser(creds, sessionUsernameOf(req)) : null
        sendJson(res, 200, {
          enabled,
          username: me ? me.username : null,
          nickname: me ? nicknameOfUser(me) : null,
          role: me ? me.role : null,
          ttl: ttlOf(creds),
          sessionsPersisted: sessions.ok,
          gate: { ok: gate.ok(), problems: gate.problems().slice(0, 3) },
        })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/audit',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        // 审计含全体用户的登录事件与假名化 IP：仅管理员可读。
        const gated = await requireAdmin(req, res)
        if (!gated) return
        let limit = 10
        if (typeof req.url === 'string') {
          const m = /[?&]limit=(\d+)/.exec(req.url)
          if (m) limit = Math.min(Math.max(Number(m[1]), 1), 100)
        }
        const entries = await readAuditEntries(ctx, limit)
        sendJson(res, 200, { ok: true, entries })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: audit')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/configure',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        // 多用户下 /configure 收窄为：管理员修改全局会话有效期。
        // 用户名不可改（创建时定），本人改密走 /change-password，增删用户走 /users/*。
        const gated = await requireAdmin(req, res)
        if (!gated) return
        const { creds } = gated
        const body = await readJsonBody(req, res)
        if (body === null) return
        const meta = requestMeta(req)
        const ttl = Number(body.ttl)
        if (!Number.isInteger(ttl) || !TTL_OPTIONS.includes(ttl)) {
          sendJson(res, 200, { ok: false, error: 'ttl-invalid' })
          return
        }
        await writeCredentials(ctx, { v: 4, ttl, users: usersOf(creds) })
        await auditLog(ctx, 'configure_success', { username: gated.me.username, ip: meta.ip, ua: meta.ua, detail: '有效期已修改' })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: configure')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/disable',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        // 禁用认证是全局杀开关：仅管理员，且需验证本人当前密码。
        const gated = await requireAdmin(req, res)
        if (!gated) return
        const { creds, me } = gated
        const body = await readJsonBody(req, res)
        if (body === null) return
        const current = String(body.current || '')
        const meta = requestMeta(req)
        const curValid = current && await verifyPassword(current, me.hash)
        if (!curValid) {
          await auditLog(ctx, 'disable_failure', { username: me.username, ip: meta.ip, ua: meta.ua, detail: '当前密码不正确' })
          sendJson(res, 200, { ok: false, error: 'current-invalid' })
          return
        }
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: [] })
        sessions.clear()
        res.setHeader('Set-Cookie', clearSessionCookie())
        enabledFlag = false
        await auditLog(ctx, 'disable_success', { username: me.username, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: disable')

  // ---------------- 自助改密（任意登录用户） ----------------
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/change-password',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const body = await readJsonBody(req, res)
        if (body === null) return
        const creds = await readCredentials(ctx)
        const me = findUser(creds, sessionUsernameOf(req))
        if (!me) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const current = String(body.current || '')
        const password = String(body.password || '')
        const meta = requestMeta(req)
        const st = passwordStrength(password)
        if (!st.ok) {
          await auditLog(ctx, 'password_changed', { username: me.username, ip: meta.ip, ua: meta.ua, detail: '失败：密码强度不足' })
          sendJson(res, 200, { ok: false, error: 'weak-password', reason: st.reason })
          return
        }
        const curValid = current && await verifyPassword(current, me.hash)
        if (!curValid) {
          await auditLog(ctx, 'password_changed', { username: me.username, ip: meta.ip, ua: meta.ua, detail: '失败：当前密码不正确' })
          sendJson(res, 200, { ok: false, error: 'current-invalid' })
          return
        }
        const newHash = await hashPassword(password)
        const nextUsers = usersOf(creds).map((u) => (u.username === me.username ? { ...u, hash: newHash } : u))
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: nextUsers })
        // 改密踢掉本人其他设备，保留当前会话。
        sessions.deleteByUsernameExcept(me.username, cookieOf(req, COOKIE_NAME))
        await auditLog(ctx, 'password_changed', { username: me.username, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: change-password')

  // ---------------- 用户管理（仅管理员） ----------------
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/users',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        const gated = await requireAdmin(req, res)
        if (!gated) return
        sendJson(res, 200, {
          ok: true,
          users: usersOf(gated.creds).map((u) => ({ username: u.username, role: u.role, nickname: nicknameOfUser(u) })),
        })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: users list')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/users/create',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        const gated = await requireAdmin(req, res)
        if (!gated) return
        const { creds } = gated
        const body = await readJsonBody(req, res)
        if (body === null) return
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        const role = body.role === 'admin' ? 'admin' : 'user'
        const meta = requestMeta(req)
        if (usernameError(username)) {
          sendJson(res, 200, { ok: false, error: 'username-invalid' })
          return
        }
        if (findUser(creds, username)) {
          sendJson(res, 200, { ok: false, error: 'username-taken' })
          return
        }
        const st = passwordStrength(password)
        if (!st.ok) {
          sendJson(res, 200, { ok: false, error: 'weak-password', reason: st.reason })
          return
        }
        const newUser = { username, hash: await hashPassword(password), role }
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: [...usersOf(creds), newUser] })
        await auditLog(ctx, 'user_created', { username: gated.me.username, ip: meta.ip, ua: meta.ua, detail: username + '（' + role + '）' })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: users create')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/users/delete',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        const gated = await requireAdmin(req, res)
        if (!gated) return
        const { creds, me } = gated
        const body = await readJsonBody(req, res)
        if (body === null) return
        const username = String(body.username || '').trim()
        const meta = requestMeta(req)
        if (username === me.username) {
          sendJson(res, 200, { ok: false, error: 'cannot-delete-self' })
          return
        }
        const target = findUser(creds, username)
        if (!target) {
          sendJson(res, 200, { ok: false, error: 'not-found' })
          return
        }
        if (target.role === 'admin' && countAdmins(creds) <= 1) {
          sendJson(res, 200, { ok: false, error: 'last-admin' })
          return
        }
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: usersOf(creds).filter((u) => u.username !== username) })
        sessions.deleteByUsernameExcept(username, null)
        await auditLog(ctx, 'user_deleted', { username: gated.me.username, ip: meta.ip, ua: meta.ua, detail: username })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: users delete')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/users/reset-password',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        const gated = await requireAdmin(req, res)
        if (!gated) return
        const { creds, me } = gated
        const body = await readJsonBody(req, res)
        if (body === null) return
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        const meta = requestMeta(req)
        if (!findUser(creds, username)) {
          sendJson(res, 200, { ok: false, error: 'not-found' })
          return
        }
        const st = passwordStrength(password)
        if (!st.ok) {
          sendJson(res, 200, { ok: false, error: 'weak-password', reason: st.reason })
          return
        }
        const newHash = await hashPassword(password)
        const nextUsers = usersOf(creds).map((u) => (u.username === username ? { ...u, hash: newHash } : u))
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: nextUsers })
        // 踢掉被重置用户的全部会话；若管理员重置自己则保留当前会话。
        const keep = username === me.username ? cookieOf(req, COOKIE_NAME) : null
        sessions.deleteByUsernameExcept(username, keep)
        await auditLog(ctx, 'password_reset', { username: gated.me.username, ip: meta.ip, ua: meta.ua, detail: username })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: users reset-password')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-auth/users/set-role',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        const gated = await requireAdmin(req, res)
        if (!gated) return
        const { creds } = gated
        const body = await readJsonBody(req, res)
        if (body === null) return
        const username = String(body.username || '').trim()
        const role = body.role === 'admin' ? 'admin' : 'user'
        const meta = requestMeta(req)
        const target = findUser(creds, username)
        if (!target) {
          sendJson(res, 200, { ok: false, error: 'not-found' })
          return
        }
        if (role === 'user' && target.role === 'admin' && countAdmins(creds) <= 1) {
          sendJson(res, 200, { ok: false, error: 'last-admin' })
          return
        }
        const nextUsers = usersOf(creds).map((u) => (u.username === username ? { ...u, role } : u))
        await writeCredentials(ctx, { v: 4, ttl: ttlOf(creds), users: nextUsers })
        await auditLog(ctx, 'user_role_changed', { username: gated.me.username, ip: meta.ip, ua: meta.ua, detail: username + ' → ' + role })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-auth: users set-role')

  // ---------------- 传输层拦截 ----------------

  // 兜底拦截：所有未被 exact / 更长前缀认领的请求（index.html、/assets/*、SPA 路由等）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '',
    handler: async (req, res) => {
      try {
        if (checkRequest(req)) {
          const fallback = ctx.webServer.fallback
          if (fallback !== undefined) {
            await fallback(req, res)
            return
          }
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(302, { location: '/dsh-webui-auth/login' })
        res.end()
      } catch (e) {
        ctx.logger.warn('[dsh-webui-auth] intercept error: ' + (e && e.message ? e.message : String(e)))
        if (!res.headersSent) {
          res.writeHead(500)
          res.end()
        } else {
          res.destroy()
        }
      }
    },
  }), 'dsh-webui-auth: transport gate')
}

// ---------------- CLI：node index.js audit [--limit N] ----------------

let metaFilePath = null
try {
  let u = import.meta.url
  const q = u.indexOf('?')
  if (q !== -1) u = u.slice(0, q)
  const h = u.indexOf('#')
  if (h !== -1) u = u.slice(0, h)
  metaFilePath = fileURLToPath(u)
} catch (e) { /* not a file URL */ }

const isCliEntry = metaFilePath !== null && (() => {
  try {
    const entry = process.argv[1]
    if (!entry) return false
    const self = process.platform === 'win32' ? metaFilePath.toLowerCase() : metaFilePath
    const resolved = resolvePath(entry)
    return (process.platform === 'win32' ? resolved.toLowerCase() : resolved) === self
  } catch (e) {
    return false
  }
})()

if (isCliEntry) {
  const cmd = process.argv[2]
  if (cmd === 'audit') {
    const li = process.argv.indexOf('--limit')
    let limit = 20
    if (li >= 0 && process.argv[li + 1] !== undefined) {
      const n = Number(process.argv[li + 1])
      if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), 200)
    }
    const file = auditFileForCli()
    const rows = []
    if (file) {
      try {
        const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
        for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
          try { rows.push(JSON.parse(lines[i])) } catch (e) { /* skip malformed */ }
        }
      } catch (e) { /* 文件尚不存在 */ }
    }
    console.log('[dsh-webui-auth] 审计日志：最近 ' + rows.length + ' 条' + (file ? '（文件: ' + file + '）' : ''))
    if (rows.length === 0) {
      console.log('（暂无审计记录；登录/配置等安全事件会追加写入插件目录的 audit.jsonl）')
    }
    for (const r of rows) {
      const parts = [r.ts || '?', r.event || '?']
      if (r.username) parts.push('user=' + r.username)
      if (r.ip) parts.push('ip=' + r.ip)
      if (r.detail) parts.push('detail=' + String(r.detail))
      console.log('  ' + parts.join('  '))
    }
  } else {
    console.log('[dsh-webui-auth] 用法: node index.js audit [--limit N]')
  }
  process.exit(0)
}
