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
  } catch (e) {
    console.error("加载消息失败:", e.message);
    return [];
  }
}

async function saveMessage(msg) {
  try { await supabaseQuery("messages", "POST", { body: msg }); return true; }
  catch (e) { console.error("保存消息失败:", e.message); return false; }
}

async function deleteMessage(id) {
  try { await supabaseQuery("messages", "DELETE", { query: `id=eq.${encodeURIComponent(id)}` }); return true; }
  catch (e) { console.error("删除消息失败:", e.message); return false; }
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

app.get("/api/messages", async (req, res) => {
  const messages = await loadMessages();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;
  if (isAdmin) {
    res.json({ messages, isAdmin: true });
  } else {
    res.json({ messages: messages.filter(m => m.mode === "public"), isAdmin: false });
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
      time: new Date().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }),
      timestamp: Date.now(),
    };

    const saved = await saveMessage(msg);
    if (saved) res.json({ success: true });
    else res.status(500).json({ error: "保存失败，请重试" });
  } catch (e) {
    console.error("发送留言失败:", e);
    res.status(500).json({ error: "服务器错误" });
  }
});

app.post("/api/auth", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ error: "密码错误" });
});

app.delete("/api/messages/:id", async (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: "需要管理员权限" });
  const deleted = await deleteMessage(req.params.id);
  if (deleted) res.json({ success: true });
  else res.status(500).json({ error: "删除失败" });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "图片大小不能超过800KB" });
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
