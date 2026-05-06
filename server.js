const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 配置 ==========
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "happy2026"; // 管理密码，部署时可通过环境变量修改
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

// ========== 数据存储 ==========
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "data", "uploads");
const MSG_FILE = path.join(DATA_DIR, "messages.json");

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadMessages() {
  try {
    if (fs.existsSync(MSG_FILE)) {
      return JSON.parse(fs.readFileSync(MSG_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("读取消息失败:", e);
  }
  return [];
}

function saveMessages(messages) {
  fs.writeFileSync(MSG_FILE, JSON.stringify(messages, null, 2), "utf-8");
}

// ========== 中间件 ==========
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// 图片上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("只能上传图片文件"));
  },
});

// ========== API 路由 ==========

// 获取留言（公开 or 全部）
app.get("/api/messages", (req, res) => {
  const messages = loadMessages();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;
  if (isAdmin) {
    res.json({ messages, isAdmin: true });
  } else {
    const publicMsgs = messages.filter((m) => m.mode === "public");
    res.json({ messages: publicMsgs, isAdmin: false });
  }
});

// 获取统计
app.get("/api/stats", (req, res) => {
  const messages = loadMessages();
  res.json({
    total: messages.length,
    public: messages.filter((m) => m.mode === "public").length,
    anonymous: messages.filter((m) => m.mode === "anonymous").length,
  });
});

// 发送留言
app.post("/api/messages", upload.single("image"), (req, res) => {
  try {
    const { name, text, mode } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "留言内容不能为空" });
    }
    if (mode === "public" && (!name || !name.trim())) {
      return res.status(400).json({ error: "公开留言请填写名字" });
    }

    const messages = loadMessages();
    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name ? name.trim() : "匿名来客",
      text: text.trim(),
      mode: mode === "anonymous" ? "anonymous" : "public",
      image: req.file ? "/uploads/" + req.file.filename : null,
      time: new Date().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Date.now(),
    };

    messages.unshift(msg); // 新消息在前
    saveMessages(messages);

    res.json({ success: true, message: msg });
  } catch (e) {
    console.error("发送留言失败:", e);
    res.status(500).json({ error: "服务器错误" });
  }
});

// 验证管理员密码
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "密码错误" });
  }
});

// 删除留言（管理员）
app.delete("/api/messages/:id", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "需要管理员权限" });
  }

  let messages = loadMessages();
  const target = messages.find((m) => m.id === req.params.id);

  if (target && target.image) {
    const imgPath = path.join(__dirname, target.image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }

  messages = messages.filter((m) => m.id !== req.params.id);
  saveMessages(messages);
  res.json({ success: true });
});

// multer 错误处理
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "图片大小不能超过2MB" });
    }
    return res.status(400).json({ error: "上传失败: " + err.message });
  }
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  next();
});

// ========== 启动 ==========
app.listen(PORT, () => {
  console.log(`🎂 生日留言板已启动: http://localhost:${PORT}`);
  console.log(`🔐 管理密码: ${ADMIN_PASSWORD}`);
});
