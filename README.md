# 🎂 生日留言板

一个支持公开/匿名留言、图片上传的生日祝福墙。

## ✨ 功能

- 🌍 **公开留言**：所有人可见
- 🔒 **匿名留言**：仅寿星（管理员）可见，不显示名字
- 📷 **图片上传**：支持每条留言附带一张图片（最大2MB）
- 🔐 **管理模式**：输入密码查看匿名留言、删除留言
- 📱 **手机适配**：手机电脑都能用
- 💾 **数据持久化**：留言保存在服务器上，不会丢失

## 🔑 管理密码

默认密码：`happy2026`

修改方式：部署时设置环境变量 `ADMIN_PASSWORD=你的密码`

---

## 🚀 部署教程（三选一）

### 方法一：Render（推荐，最简单，免费）

1. 注册 GitHub 账号：https://github.com（如果已有跳过）

2. 在 GitHub 上创建仓库：
   - 点右上角 `+` → `New repository`
   - 名字填 `birthday-board`，选 Public，点 `Create repository`
   - 把这个项目的所有文件上传到仓库中（直接拖拽上传即可）

3. 注册 Render 账号：https://render.com
   - 用 GitHub 账号直接登录

4. 部署：
   - 点 `New` → `Web Service`
   - 选择你刚才的 `birthday-board` 仓库
   - 填写配置：
     - **Name**: `birthday-board`（或你喜欢的名字）
     - **Runtime**: `Node`
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
   - 点击 `Advanced` → `Add Environment Variable`：
     - Key: `ADMIN_PASSWORD`  Value: `你想设的密码`
   - 选择 **Free** 套餐
   - 点 `Create Web Service`

5. 等2-3分钟部署完成，会给你一个类似 `https://birthday-board-xxxx.onrender.com` 的链接

6. 把这个链接发给朋友们就行！

> ⚠️ Render 免费版会在15分钟无人访问后休眠，首次打开可能需要等30秒左右

---

### 方法二：Railway（简单，免费额度）

1. 注册 GitHub 账号并上传代码（同上）

2. 注册 Railway 账号：https://railway.app
   - 用 GitHub 登录

3. 部署：
   - 点 `New Project` → `Deploy from GitHub repo`
   - 选择 `birthday-board` 仓库
   - Railway 会自动检测并部署

4. 设置环境变量：
   - 点击项目 → `Variables` → 添加 `ADMIN_PASSWORD`

5. 生成域名：
   - 点击 `Settings` → `Networking` → `Generate Domain`
   - 得到链接后分享给朋友

---

### 方法三：本地运行（测试用）

如果你电脑上已经装了 Node.js：

```bash
# 解压项目文件
cd birthday-board

# 安装依赖
npm install

# 启动
npm start
```

打开浏览器访问 `http://localhost:3000` 即可。

---

## 📁 项目结构

```
birthday-board/
├── server.js           # 服务器（Express）
├── package.json        # 项目配置
├── public/
│   └── index.html      # 前端页面
├── data/               # 数据存储目录（自动创建）
│   ├── messages.json   # 留言数据
│   └── uploads/        # 上传的图片
└── README.md           # 本文件
```

## ❓ 常见问题

**Q: 如何修改管理密码？**
A: 部署时设置环境变量 `ADMIN_PASSWORD=新密码`

**Q: 如何修改页面标题和文字？**
A: 编辑 `public/index.html`，搜索 "生日快乐" 替换成你想要的文字

**Q: 国内能访问吗？**
A: Render 和 Railway 的链接在国内大部分地区可以正常访问。如果有问题，可以绑定自己的域名。

**Q: 数据安全吗？**
A: 匿名留言只有输入管理密码才能查看。但请注意，这是一个简单项目，不建议用于存储敏感信息。
