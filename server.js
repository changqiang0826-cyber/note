const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "happy2026";
const MAX_IMAGE_SIZE = 800 * 1024;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("⚠️ 未设置 SUPABASE_URL 和 SUPABASE_KEY 环境变量！");
}

async function supabaseQuery(table, method, options = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  if (method === "POST") headers["Prefer"] = "return=representation";
  if (method === "PATCH") headers["Prefer"] = "return=representation";
  if (options.query) url += `?${options.query}`;
  const fetchOpts = { method, headers };
  if (options.body) fetchOpts.body = JSON.stringify(options.body);
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadMessages() {
  try {
    return (await supabaseQuery("messages", "GET", { query: "select=*&order=timestamp.desc" })) || [];
  } catch (e) { console.error("加载消息失败:", e.message); return []; }
}

async function loadReplies() {
  try {
    return (await supabaseQuery("replies", "GET", { query: "select=*&order=timestamp.asc" })) || [];
  } catch (e) { console.error("加载回复失败:", e.message); return []; }
}

async function saveMessage(msg) {
  try { await supabaseQuery("messages", "POST", { body: msg }); return true; }
  catch (e) { console.error("保存消息失败:", e.message); return false; }
}

async function saveReply(reply) {
  try { await supabaseQuery("replies", "POST", { body: reply }); return true; }
  catch (e) { console.error("保存回复失败:", e.message); return false; }
}

async function deleteMessage(id) {
  try {
    // 先删回复
    await supabaseQuery("replies", "DELETE", { query: `message_id=eq.${encodeURIComponent(id)}` });
    await supabaseQuery("messages", "DELETE", { query: `id=eq.${encodeURIComponent(id)}` });
    return true;
  } catch (e) { console.error("删除消息失败:", e.message); return false; }
}

async function deleteReply(id) {
  try { await supabaseQuery("replies", "DELETE", { query: `id=eq.${encodeURIComponent(id)}` }); return true; }
  catch (e) { console.error("删除回复失败:", e.message); return false; }
}

async function likeMessage(id) {
  try {
    const msgs = await supabaseQuery("messages", "GET", { query: `id=eq.${encodeURIComponent(id)}&select=likes` });
    if (!msgs || !msgs.length) return null;
    const current = msgs[0].likes || 0;
    const updated = await supabaseQuery("messages", "PATCH", {
      query: `id=eq.${encodeURIComponent(id)}`,
      body: { likes: current + 1 }
    });
    return updated && updated[0] ? updated[0].likes : current + 1;
  } catch (e) { console.error("点赞失败:", e.message); return null; }
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("只能上传图片文件"));
  },
});

// 获取留言 + 回复
app.get("/api/messages", async (req, res) => {
  const messages = await loadMessages();
  const replies = await loadReplies();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;

  // 把回复挂到对应留言下
  const replyMap = {};
  replies.forEach(r => {
    if (!replyMap[r.message_id]) replyMap[r.message_id] = [];
    replyMap[r.message_id].push(r);
  });
  const enriched = messages.map(m => ({ ...m, replies: replyMap[m.id] || [] }));

  if (isAdmin) {
    res.json({ messages: enriched, isAdmin: true });
  } else {
    res.json({ messages: enriched.filter(m => m.mode === "public"), isAdmin: false });
  }
});

app.get("/api/stats", async (req, res) => {
  const messages = await loadMessages();
  res.json({
    total: messages.length,
    public: messages.filter(m => m.mode === "public").length,
    anonymous: messages.filter(m => m.mode === "anonymous").length,
  });
});

// 发留言
app.post("/api/messages", upload.single("image"), async (req, res) => {
  try {
    const { name, text, mode } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "留言内容不能为空" });
    if (mode === "public" && (!name || !name.trim())) return res.status(400).json({ error: "公开留言请填写名字" });

    let imageData = null;
    if (req.file) {
      imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    }

    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name ? name.trim() : "匿名来客",
      text: text.trim(),
      mode: mode === "anonymous" ? "anonymous" : "public",
      image: imageData,
      likes: 0,
      time: new Date().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }),
      timestamp: Date.now(),
    };

    const saved = await saveMessage(msg);
    if (saved) res.json({ success: true });
    else res.status(500).json({ error: "保存失败" });
  } catch (e) {
    console.error("发送留言失败:", e);
    res.status(500).json({ error: "服务器错误" });
  }
});

// 点赞
app.post("/api/messages/:id/like", async (req, res) => {
  const newCount = await likeMessage(req.params.id);
  if (newCount !== null) res.json({ success: true, likes: newCount });
  else res.status(500).json({ error: "点赞失败" });
});

// 回复
app.post("/api/messages/:id/reply", async (req, res) => {
  const { name, text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "回复内容不能为空" });

  const reply = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    message_id: req.params.id,
    name: name ? name.trim() : "匿名",
    text: text.trim(),
    time: new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    timestamp: Date.now(),
  };

  const saved = await saveReply(reply);
  if (saved) res.json({ success: true });
  else res.status(500).json({ error: "回复失败" });
});

// 管理员验证
app.post("/api/auth", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ error: "密码错误" });
});

// 删除留言（管理员）
app.delete("/api/messages/:id", async (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: "需要管理员权限" });
  const deleted = await deleteMessage(req.params.id);
  if (deleted) res.json({ success: true });
  else res.status(500).json({ error: "删除失败" });
});

// 删除回复（管理员）
app.delete("/api/replies/:id", async (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: "需要管理员权限" });
  const deleted = await deleteReply(req.params.id);
  if (deleted) res.json({ success: true });
  else res.status(500).json({ error: "删除失败" });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "图片不能超过800KB" });
    return res.status(400).json({ error: "上传失败: " + err.message });
  }
  if (err) return res.status(500).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`✨ 留言板已启动: http://localhost:${PORT}`);
  console.log(`🔐 管理密码: ${ADMIN_PASSWORD}`);
  console.log(`📦 Supabase: ${SUPABASE_URL ? "已连接" : "未配置"}`);
});
