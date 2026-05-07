const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "happy2026";
const MAX_IMAGE_SIZE = 800 * 1024;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ========== Supabase REST ==========
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

// ========== Supabase Auth helpers ==========
async function supabaseAuth(endpoint, method, body, token) {
  const url = `${SUPABASE_URL}/auth/v1/${endpoint}`;
  const h = { "apikey": SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw { status: r.status, message: data.error_description || data.msg || data.message || "认证失败" };
  return data;
}

// Verify user token → return user info
async function getUser(token) {
  if (!token) return null;
  try {
    const u = await supabaseAuth("user", "GET", null, token);
    return u && u.id ? u : null;
  } catch { return null; }
}

// Auth middleware
function authRequired(req, res, next) {
  const token = req.headers["x-token"];
  getUser(token).then(u => {
    if (!u) return res.status(401).json({ error: "请先登录" });
    req.user = u;
    req.displayName = (u.user_metadata && u.user_metadata.display_name) || u.email.split("@")[0];
    next();
  }).catch(() => res.status(401).json({ error: "请先登录" }));
}

// ========== Middleware ==========
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("只能上传图片"));
  },
});

// ========== Auth API ==========
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: "请填写邮箱和密码" });
    if (password.length < 6) return res.status(400).json({ error: "密码至少6位" });
    if (!displayName || !displayName.trim()) return res.status(400).json({ error: "请填写昵称" });

    const data = await supabaseAuth("signup", "POST", {
      email: email.trim(),
      password,
      data: { display_name: displayName.trim().slice(0, 20) }
    });

    // Supabase 可能需要邮箱确认
    if (data.id && !data.confirmed_at && (!data.identities || data.identities.length === 0)) {
      return res.json({ success: true, needConfirm: true, message: "注册成功！请查收验证邮件" });
    }

    // 如果不需要确认（或已确认），直接登录
    if (data.access_token) {
      return res.json({ success: true, token: data.access_token, user: { email: data.user?.email, displayName: data.user?.user_metadata?.display_name } });
    }

    res.json({ success: true, needConfirm: true, message: "注册成功！请查收验证邮件后登录" });
  } catch (e) {
    const msg = e.message || "注册失败";
    if (msg.includes("already been registered")) return res.status(400).json({ error: "该邮箱已注册" });
    res.status(e.status || 500).json({ error: msg });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "请填写邮箱和密码" });

    const data = await supabaseAuth("token?grant_type=password", "POST", {
      email: email.trim(), password
    });

    res.json({
      success: true,
      token: data.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: data.user.user_metadata?.display_name || data.user.email.split("@")[0]
      }
    });
  } catch (e) {
    const msg = e.message || "登录失败";
    if (msg.includes("Invalid login")) return res.status(401).json({ error: "邮箱或密码错误" });
    if (msg.includes("Email not confirmed")) return res.status(401).json({ error: "请先验证邮箱，查看收件箱" });
    res.status(e.status || 500).json({ error: msg });
  }
});

app.post("/api/auth/recover", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "请输入邮箱" });
    await supabaseAuth("recover", "POST", { email: email.trim() });
    res.json({ success: true, message: "重置邮件已发送，请查收" });
  } catch (e) {
    res.json({ success: true, message: "如果该邮箱已注册，重置邮件将会发送" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const token = req.headers["x-token"];
  const u = await getUser(token);
  if (!u) return res.status(401).json({ error: "未登录" });
  res.json({
    id: u.id, email: u.email,
    displayName: u.user_metadata?.display_name || u.email.split("@")[0]
  });
});

// ========== Messages API ==========
app.get("/api/messages", async (req, res) => {
  try {
    const messages = (await sb("messages", "GET", { query: "select=*&order=timestamp.desc" })) || [];
    const replies = (await sb("replies", "GET", { query: "select=*&order=timestamp.asc" })) || [];
    const isAdmin = req.query.admin === ADMIN_PASSWORD;

    const rm = {};
    replies.forEach(r => { if (!rm[r.message_id]) rm[r.message_id] = []; rm[r.message_id].push(r); });
    const enriched = messages.map(m => ({ ...m, replies: rm[m.id] || [] }));

    if (isAdmin) res.json({ messages: enriched, isAdmin: true });
    else res.json({ messages: enriched.filter(m => m.mode === "public"), isAdmin: false });
  } catch (e) { res.json({ messages: [], isAdmin: false }); }
});

app.get("/api/stats", async (req, res) => {
  try {
    const m = (await sb("messages", "GET", { query: "select=mode" })) || [];
    res.json({ total: m.length, public: m.filter(x => x.mode === "public").length, anonymous: m.filter(x => x.mode === "anonymous").length });
  } catch { res.json({ total: 0, public: 0, anonymous: 0 }); }
});

app.post("/api/messages", authRequired, upload.single("image"), async (req, res) => {
  try {
    const { text, mode } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "留言内容不能为空" });

    let img = null;
    if (req.file) img = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      user_id: req.user.id,
      name: req.displayName,
      text: text.trim(),
      mode: mode === "anonymous" ? "anonymous" : "public",
      image: img, likes: 0,
      time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
    };

    await sb("messages", "POST", { body: msg });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "发送失败" }); }
});

// 点赞
app.post("/api/messages/:id/like", authRequired, async (req, res) => {
  try {
    const msgs = await sb("messages", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=user_id,likes` });
    if (!msgs || !msgs.length) return res.status(404).json({ error: "留言不存在" });
    if (msgs[0].user_id === req.user.id) return res.status(400).json({ error: "不能给自己点赞" });

    const updated = await sb("messages", "PATCH", { query: `id=eq.${encodeURIComponent(req.params.id)}`, body: { likes: (msgs[0].likes || 0) + 1 } });
    res.json({ success: true, likes: updated[0].likes });
  } catch (e) { res.status(500).json({ error: "点赞失败" }); }
});

// 回复
app.post("/api/messages/:id/reply", authRequired, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "回复不能为空" });

    await sb("replies", "POST", { body: {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      message_id: req.params.id,
      user_id: req.user.id,
      name: req.displayName,
      text: text.trim(),
      time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
    }});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "回复失败" }); }
});

// 删除留言（自己的 or 管理员）
app.delete("/api/messages/:id", async (req, res) => {
  try {
    const isAdmin = req.body.password === ADMIN_PASSWORD;
    let userId = null;

    if (!isAdmin) {
      const token = req.headers["x-token"];
      const u = await getUser(token);
      if (!u) return res.status(401).json({ error: "请先登录" });
      userId = u.id;
    }

    if (!isAdmin && userId) {
      const msgs = await sb("messages", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=user_id` });
      if (!msgs || !msgs.length) return res.status(404).json({ error: "留言不存在" });
      if (msgs[0].user_id !== userId) return res.status(403).json({ error: "只能删除自己的留言" });
    }

    await sb("replies", "DELETE", { query: `message_id=eq.${encodeURIComponent(req.params.id)}` });
    await sb("messages", "DELETE", { query: `id=eq.${encodeURIComponent(req.params.id)}` });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "删除失败" }); }
});

// 删除回复（管理员）
app.delete("/api/replies/:id", async (req, res) => {
  try {
    const isAdmin = req.body.password === ADMIN_PASSWORD;
    let userId = null;

    if (!isAdmin) {
      const token = req.headers["x-token"];
      const u = await getUser(token);
      if (!u) return res.status(401).json({ error: "请先登录" });
      userId = u.id;
    }

    if (!isAdmin && userId) {
      const reps = await sb("replies", "GET", { query: `id=eq.${encodeURIComponent(req.params.id)}&select=user_id` });
      if (!reps || !reps.length) return res.status(404).json({ error: "回复不存在" });
      if (reps[0].user_id !== userId) return res.status(403).json({ error: "只能删除自己的回复" });
    }

    await sb("replies", "DELETE", { query: `id=eq.${encodeURIComponent(req.params.id)}` });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "删除失败" }); }
});

// 管理员验证
app.post("/api/admin/auth", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ error: "密码错误" });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "图片不能超过800KB" });
  if (err) return res.status(500).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`✨ 留言板已启动: http://localhost:${PORT}`);
  console.log(`📦 Supabase: ${SUPABASE_URL ? "已连接" : "未配置"}`);
});
