const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "happy2026";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sb(table, method, opts = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const h = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (method === "POST" || method === "PATCH") h["Prefer"] = "return=representation";
  if (opts.query) url += `?${opts.query}`;
  const o = { method, headers: h };
  if (opts.body) o.body = JSON.stringify(opts.body);
  const r = await fetch(url, o);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function supabaseAuth(endpoint, method, body, token) {
  const url = `${SUPABASE_URL}/auth/v1/${endpoint}`;
  const h = { "apikey": SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw { status: r.status, message: data.error_description || data.msg || data.message || "认证失败" };
  return data;
}

async function getUser(token) {
  if (!token) return null;
  try { const u = await supabaseAuth("user", "GET", null, token); return u?.id ? u : null; } catch { return null; }
}

function authRequired(req, res, next) {
  getUser(req.headers["x-token"]).then(u => {
    if (!u) return res.status(401).json({ error: "请先登录" });
    req.user = u;
    req.displayName = u.user_metadata?.display_name || u.email.split("@")[0];
    req.avatar = u.user_metadata?.avatar || null;
    next();
  }).catch(() => res.status(401).json({ error: "请先登录" }));
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 800 * 1024 }, fileFilter: (r, f, cb) => f.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("只能上传图片")) });
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 }, fileFilter: (r, f, cb) => f.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("只能上传图片")) });

// ===== Auth =====
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: "请填写邮箱和密码" });
    if (password.length < 6) return res.status(400).json({ error: "密码至少6位" });
    if (!displayName?.trim()) return res.status(400).json({ error: "请填写昵称" });
    const data = await supabaseAuth("signup", "POST", { email: email.trim(), password, data: { display_name: displayName.trim().slice(0, 20) } });
    if (data.id && !data.confirmed_at && (!data.identities || !data.identities.length))
      return res.json({ success: true, needConfirm: true, message: "注册成功！请查收验证邮件后登录" });
    if (data.access_token) return res.json({ success: true, token: data.access_token, user: { id: data.user?.id, email: data.user?.email, displayName: data.user?.user_metadata?.display_name, avatar: data.user?.user_metadata?.avatar } });
    res.json({ success: true, needConfirm: true, message: "注册成功！请查收验证邮件后登录" });
  } catch (e) {
    if ((e.message || "").includes("already been registered")) return res.status(400).json({ error: "该邮箱已注册" });
    res.status(e.status || 500).json({ error: e.message || "注册失败" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "请填写邮箱和密码" });
    const data = await supabaseAuth("token?grant_type=password", "POST", { email: email.trim(), password });
    res.json({ success: true, token: data.access_token, user: { id: data.user.id, email: data.user.email, displayName: data.user.user_metadata?.display_name || data.user.email.split("@")[0], avatar: data.user.user_metadata?.avatar } });
  } catch (e) {
    if ((e.message || "").includes("Invalid login")) return res.status(401).json({ error: "邮箱或密码错误" });
    if ((e.message || "").includes("Email not confirmed")) return res.status(401).json({ error: "请先验证邮箱" });
    res.status(e.status || 500).json({ error: e.message || "登录失败" });
  }
});

app.post("/api/auth/recover", async (req, res) => {
  try { if (!req.body.email) return res.status(400).json({ error: "请输入邮箱" }); await supabaseAuth("recover", "POST", { email: req.body.email.trim() }); res.json({ success: true, message: "重置邮件已发送" }); } catch { res.json({ success: true, message: "如果该邮箱已注册，重置邮件将发送" }); }
});

app.get("/api/auth/me", async (req, res) => {
  const u = await getUser(req.headers["x-token"]);
  if (!u) return res.status(401).json({ error: "未登录" });
  res.json({ id: u.id, email: u.email, displayName: u.user_metadata?.display_name || u.email.split("@")[0], avatar: u.user_metadata?.avatar });
});

app.post("/api/auth/profile", authRequired, avatarUpload.single("avatar"), async (req, res) => {
  try {
    const updates = {};
    if (req.body.displayName) updates.display_name = req.body.displayName.trim().slice(0, 20);
    if (req.file) updates.avatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    if (req.body.removeAvatar === "true") updates.avatar = null;
    if (!Object.keys(updates).length) return res.status(400).json({ error: "没有要更新的内容" });
    await supabaseAuth("user", "PUT", { data: updates }, req.headers["x-token"]);
    if (updates.display_name) {
      await sb("messages", "PATCH", { query: `user_id=eq.${encodeURIComponent(req.user.id)}`, body: { name: updates.display_name } }).catch(() => {});
      await sb("replies", "PATCH", { query: `user_id=eq.${encodeURIComponent(req.user.id)}`, body: { name: updates.display_name } }).catch(() => {});
    }
    res.json({ success: true, displayName: updates.display_name || req.displayName, avatar: updates.avatar !== undefined ? updates.avatar : req.avatar });
  } catch (e) { res.status(500).json({ error: "更新失败" }); }
});

app.post("/api/auth/password", async (req, res) => {
  try { if (!req.body.password || req.body.password.length < 6) return res.status(400).json({ error: "新密码至少6位" }); await supabaseAuth("user", "PUT", { password: req.body.password }, req.headers["x-token"]); res.json({ success: true }); } catch { res.status(500).json({ error: "修改失败" }); }
});

// ===== Messages =====
app.get("/api/messages", async (req, res) => {
  try {
    const messages = (await sb("messages", "GET", { query: "select=*&order=timestamp.desc" })) || [];
    const replies = (await sb("replies", "GET", { query: "select=*&order=timestamp.asc" })) || [];
    const reactions = (await sb("reactions", "GET", { query: "select=*" })) || [];
    const isAdmin = req.query.admin === ADMIN_PASSWORD;

    const rm = {}, rxm = {};
    replies.forEach(r => { (rm[r.message_id] = rm[r.message_id] || []).push(r); });
    reactions.forEach(r => { (rxm[r.message_id] = rxm[r.message_id] || []).push(r); });

    const enriched = messages.map(m => ({
      ...m, replies: rm[m.id] || [],
      reactions: rxm[m.id] || []
    }));

    res.json({ messages: isAdmin ? enriched : enriched.filter(m => m.mode === "public"), isAdmin });
  } catch { res.json({ messages: [], isAdmin: false }); }
});

app.get("/api/stats", async (req, res) => {
  try { const m = (await sb("messages", "GET", { query: "select=mode" })) || []; res.json({ total: m.length, public: m.filter(x => x.mode === "public").length, anonymous: m.filter(x => x.mode === "anonymous").length }); } catch { res.json({ total: 0, public: 0, anonymous: 0 }); }
});

app.post("/api/messages", authRequired, upload.single("image"), async (req, res) => {
  try {
    const { text, mode } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "留言内容不能为空" });
    let img = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` : null;
    await sb("messages", "POST", { body: {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      user_id: req.user.id, name: req.displayName, avatar: req.avatar,
      text: text.trim(), mode: mode === "anonymous" ? "anonymous" : "public",
      image: img, likes: 0, pinned: false,
      time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
    }});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "发送失败" }); }
});

// Emoji reactions
app.post("/api/messages/:id/react", authRequired, async (req, res) => {
  try {
    const { emoji } = req.body;
    const EMOJIS = ["👍", "❤️", "😂", "😢", "🔥"];
    if (!EMOJIS.includes(emoji)) return res.status(400).json({ error: "无效的表情" });

    // Check if user already reacted with this emoji
    const existing = await sb("reactions", "GET", {
      query: `message_id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${encodeURIComponent(req.user.id)}&emoji=eq.${encodeURIComponent(emoji)}&select=id`
    });

    if (existing && existing.length > 0) {
      // Remove reaction (toggle off)
      await sb("reactions", "DELETE", { query: `id=eq.${encodeURIComponent(existing[0].id)}` });
      res.json({ success: true, action: "removed" });
    } else {
      // Check if reacting to own message
      const msgs = await sb("messages", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=user_id` });
      if (msgs?.[0]?.user_id === req.user.id) return res.status(400).json({ error: "不能给自己的留言回应" });

      await sb("reactions", "POST", { body: {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        message_id: req.params.id, user_id: req.user.id, emoji, timestamp: Date.now()
      }});
      res.json({ success: true, action: "added" });
    }
  } catch (e) { res.status(500).json({ error: "操作失败" }); }
});

// Pin
app.post("/api/messages/:id/pin", async (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: "需要管理员权限" });
  try {
    const msgs = await sb("messages", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=pinned` });
    if (!msgs?.length) return res.status(404).json({ error: "不存在" });
    const p = !msgs[0].pinned;
    await sb("messages", "PATCH", { query: `id=eq.${encodeURIComponent(req.params.id)}`, body: { pinned: p } });
    res.json({ success: true, pinned: p });
  } catch { res.status(500).json({ error: "操作失败" }); }
});

// Reply
app.post("/api/messages/:id/reply", authRequired, async (req, res) => {
  try {
    if (!req.body.text?.trim()) return res.status(400).json({ error: "回复不能为空" });
    await sb("replies", "POST", { body: {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      message_id: req.params.id, user_id: req.user.id, name: req.displayName, avatar: req.avatar,
      text: req.body.text.trim(),
      time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
    }});
    res.json({ success: true });
  } catch { res.status(500).json({ error: "回复失败" }); }
});

// Delete message
app.delete("/api/messages/:id", async (req, res) => {
  try {
    const isAdm = req.body.password === ADMIN_PASSWORD;
    if (!isAdm) {
      const u = await getUser(req.headers["x-token"]);
      if (!u) return res.status(401).json({ error: "请先登录" });
      const msgs = await sb("messages", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=user_id` });
      if (!msgs?.length || msgs[0].user_id !== u.id) return res.status(403).json({ error: "只能删除自己的" });
    }
    await sb("reactions", "DELETE", { query: `message_id=eq.${encodeURIComponent(req.params.id)}` });
    await sb("replies", "DELETE", { query: `message_id=eq.${encodeURIComponent(req.params.id)}` });
    await sb("messages", "DELETE", { query: `id=eq.${encodeURIComponent(req.params.id)}` });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "删除失败" }); }
});

// Delete reply
app.delete("/api/replies/:id", async (req, res) => {
  try {
    const isAdm = req.body.password === ADMIN_PASSWORD;
    if (!isAdm) {
      const u = await getUser(req.headers["x-token"]);
      if (!u) return res.status(401).json({ error: "请先登录" });
      const reps = await sb("replies", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=user_id` });
      if (!reps?.length || reps[0].user_id !== u.id) return res.status(403).json({ error: "只能删除自己的" });
    }
    await sb("replies", "DELETE", { query: `id=eq.${encodeURIComponent(req.params.id)}` });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "删除失败" }); }
});

app.post("/api/admin/auth", (req, res) => { req.body.password === ADMIN_PASSWORD ? res.json({ success: true }) : res.status(401).json({ error: "密码错误" }); });

app.use((err, req, res, next) => { if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "文件太大" }); if (err) return res.status(500).json({ error: err.message }); next(); });
app.listen(PORT, () => console.log(`✨ 留言板已启动: http://localhost:${PORT}`));
