# CMS后台系统新手入门文档

## 目录

1. [项目介绍](#1-项目介绍)
2. [环境要求与安装](#2-环境要求与安装)
3. [项目结构说明](#3-项目结构说明)
4. [核心功能模块详解](#4-核心功能模块详解)
5. [启动与运行](#5-启动与运行)
6. [API使用指南](#6-api使用指南)
7. [常见操作](#7-常见操作)
8. [配置说明](#8-配置说明)
9. [部署指南](#9-部署指南)
10. [故障排查](#10-故障排查)

---

## 1. 项目介绍

### 1.1 项目概述

这是一个基于 **Strapi 5.x** 构建的内容管理系统（CMS），专门用于管理文档、模板和字典数据。系统提供了完整的后台管理界面和RESTful API，支持内容创建、编辑、发布等核心功能。

### 1.2 技术栈

- **后端框架**: Strapi 5.29.0
- **运行环境**: Node.js (>=18.0.0 <=22.x.x)
- **数据库**: 
  - 默认：SQLite (开发环境)
  - 支持：MySQL、PostgreSQL (生产环境)
- **文件存储**: AWS S3 (通过 `@strapi/provider-upload-aws-s3`)
- **前端**: React 18、React Router 6

### 1.3 主要功能模块

系统包含以下核心内容类型：

- **Dictionary（字典）**: 用于存储键值对形式的配置数据
- **Doc（文档）**: 文档集合管理，支持多页面文档组织
- **Doc Page（文档页面）**: 具体的文档页面内容，支持富文本编辑
- **Template（模板）**: 模板管理系统，包含丰富的元数据和分类信息

### 1.4 系统架构

```mermaid
graph TB
    Client[客户端/前端应用] --> API[Strapi REST API]
    API --> Auth[用户权限管理]
    API --> Dictionary[字典模块]
    API --> Doc[文档模块]
    API --> DocPage[文档页面模块]
    API --> Template[模板模块]
    API --> Upload[文件上传服务]
    Upload --> S3[AWS S3存储]
    Dictionary --> DB[(数据库)]
    Doc --> DB
    DocPage --> DB
    Template --> DB
    Admin[管理后台] --> API
```

---

## 2. 环境要求与安装

### 2.1 环境要求

- **Node.js**: >=18.0.0 <=22.x.x
- **npm**: >=6.0.0
- **操作系统**: macOS、Linux、Windows

### 2.2 安装步骤

#### 2.2.1 克隆项目

```bash
git clone <repository-url>
cd fanruan-cloud-cms
```

#### 2.2.2 安装依赖

```bash
npm install
```

#### 2.2.3 环境变量配置

在项目根目录创建 `.env` 文件，配置以下环境变量：

```env
# 应用密钥（必需）
APP_KEYS=your-app-keys-here
ADMIN_JWT_SECRET=your-admin-jwt-secret
API_TOKEN_SALT=your-api-token-salt
TRANSFER_TOKEN_SALT=your-transfer-token-salt

# 服务器配置
HOST=0.0.0.0
PORT=1337
NODE_ENV=development

# 数据库配置（SQLite为默认，无需配置）
# 如需使用MySQL或PostgreSQL，取消注释并配置：
# DATABASE_CLIENT=mysql
# DATABASE_HOST=localhost
# DATABASE_PORT=3306
# DATABASE_NAME=strapi
# DATABASE_USERNAME=strapi
# DATABASE_PASSWORD=strapi
# DATABASE_SSL=false

# AWS S3配置（文件上传）
CDN_URL=https://your-cdn-url.com
CDN_ROOT_PATH=uploads
AWS_ACCESS_KEY_ID=your-access-key
AWS_ACCESS_SECRET=your-secret-key
AWS_REGION=us-east-1
AWS_BUCKET=your-bucket-name
AWS_ACL=public-read
```

**重要提示**：
- `APP_KEYS` 需要是4个随机字符串，用逗号分隔，例如：`key1,key2,key3,key4`
- 所有密钥都应该使用强随机字符串生成
- 生产环境请使用环境变量管理工具，不要将 `.env` 文件提交到代码仓库

#### 2.2.4 生成密钥（可选）

可以使用以下命令生成随机密钥：

```bash
# 生成APP_KEYS（需要4个）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 生成JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

### 2.3 数据库配置

系统默认使用 SQLite 数据库，数据库文件位于 `data/database.db`。

如需切换到 MySQL 或 PostgreSQL，请修改 [config/database.js](config/database.js) 中的配置，并设置相应的环境变量。

---

## 3. 项目结构说明

### 3.1 目录结构

```
fanruan-cloud-cms/
├── config/                 # 配置文件目录
│   ├── admin.js           # 管理后台配置
│   ├── api.js             # API配置
│   ├── database.js        # 数据库配置
│   ├── middlewares.js     # 中间件配置
│   ├── plugins.js         # 插件配置（AWS S3上传）
│   └── server.js          # 服务器配置
├── data/                   # 数据目录
│   ├── database.db        # SQLite数据库文件
│   └── uploads/           # 本地上传文件（开发环境）
├── database/               # 数据库迁移文件
│   └── migrations/
├── docs/                   # 文档目录
├── public/                 # 公共静态文件
│   └── uploads/           # 公共上传文件
├── scripts/                # 脚本目录
│   └── seed.js            # 数据初始化脚本
├── src/                    # 源代码目录
│   ├── admin/             # 管理后台自定义
│   ├── api/               # API模块
│   │   ├── dictionary/    # 字典API
│   │   ├── doc/           # 文档API
│   │   ├── doc-page/      # 文档页面API
│   │   └── template/      # 模板API
│   ├── bootstrap.js       # 启动初始化逻辑
│   ├── components/        # 共享组件
│   │   └── shared/        # 共享组件（SEO、标签等）
│   ├── extensions/        # 扩展目录
│   └── index.js           # 应用入口
├── types/                  # TypeScript类型定义
│   └── generated/
├── .env                    # 环境变量文件（需自行创建）
├── docker-compose.yml      # Docker Compose配置
├── Dockerfile             # Docker镜像配置
├── package.json           # 项目依赖配置
└── README.md              # 项目说明
```

### 3.2 核心配置文件

#### 3.2.1 数据库配置 - [config/database.js](config/database.js)

支持三种数据库：
- **SQLite**（默认）：适合开发和测试
- **MySQL**：生产环境常用
- **PostgreSQL**：生产环境推荐

配置通过环境变量 `DATABASE_CLIENT` 控制。

#### 3.2.2 服务器配置 - [config/server.js](config/server.js)

- 默认端口：1337
- 默认主机：0.0.0.0
- 请求超时：30分钟（支持大文件上传）

#### 3.2.3 管理后台配置 - [config/admin.js](config/admin.js)

配置管理后台的认证密钥和功能开关。

#### 3.2.4 插件配置 - [config/plugins.js](config/plugins.js)

配置 AWS S3 文件上传插件：
- 支持文件大小：最大2GB
- 单次上传限制：500MB
- 支持所有文件类型

#### 3.2.5 中间件配置 - [config/middlewares.js](config/middlewares.js)

配置了以下中间件：
- 日志记录
- 错误处理
- CORS支持
- 请求体解析（支持2GB大文件）
- 安全策略（CSP）

#### 3.2.6 API配置 - [config/api.js](config/api.js)

- 默认分页限制：25条
- 最大分页限制：100条
- 支持返回总数统计

### 3.3 API模块结构

每个API模块都遵循Strapi的标准结构：

```
api/
└── [module-name]/
    ├── content-types/
    │   └── [module-name]/
    │       └── schema.json      # 数据模型定义
    ├── controllers/
    │   └── [module-name].js     # 控制器逻辑
    ├── routes/
    │   └── [module-name].js     # 路由定义
    └── services/
        └── [module-name].js     # 业务逻辑服务
```

---

## 4. 核心功能模块详解

### 4.1 Dictionary（字典）

字典模块用于存储键值对形式的配置数据。

**数据模型**：
- `slug` (UID, 必需): 唯一标识符
- `content` (JSON): 存储任意JSON格式的数据

**使用场景**：
- 系统配置
- 多语言翻译
- 动态配置项

**示例数据结构**：
```json
{
  "slug": "site-config",
  "content": {
    "siteName": "帆软CMS",
    "version": "1.0.0",
    "features": ["feature1", "feature2"]
  }
}
```

### 4.2 Doc（文档）

文档模块用于管理文档集合，一个文档可以包含多个文档页面。

**数据模型**：
- `url` (UID, 必需): 文档URL标识
- `title` (String, 必需): 文档标题
- `doc_pages` (Relation): 关联的文档页面（一对多）
- `listed` (Boolean): 是否在列表中显示（默认false）

**关系**：
- 一个Doc可以包含多个Doc Page
- Doc Page通过 `doc` 字段关联到Doc

### 4.3 Doc Page（文档页面）

文档页面模块存储具体的文档页面内容。

**数据模型**：
- `url` (UID, 必需): 页面URL标识
- `title` (String, 必需): 页面标题
- `content` (RichText, 必需): 富文本内容
- `doc` (Relation): 所属文档（多对一）

**功能特性**：
- 支持富文本编辑
- 支持Markdown格式
- 可关联到父文档

### 4.4 Template（模板）

模板模块是系统的核心功能，用于管理模板资源。

**数据模型详解**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `slug` | UID | 唯一标识符（可选） |
| `name` | String | 模板名称（必需） |
| `template_status` | Enum | 模板状态：public/private/delisted/pending |
| `template_link` | Text | 模板链接（必需） |
| `author` | String | 作者（默认：FanRuan） |
| `tags` | Component | 标签组件（可重复） |
| `thumbnail` | Media | 缩略图（必需） |
| `scenario` | Enum | 场景分类（8种场景） |
| `industry` | Enum | 行业分类（14种行业） |
| `language` | Enum | 语言：en-us/zh-tw |
| `seo` | Component | SEO配置组件 |
| `free` | Boolean | 是否免费（默认true） |
| `price` | Integer | 价格（可选） |
| `featured` | Boolean | 是否推荐（默认false） |
| `product` | Enum | 产品类型：FineBI/FineReport/FineVis/FineDataLink |
| `description` | RichText | 描述（可选） |
| `download_link` | String | 下载链接（默认"#"） |
| `supported_version` | String | 支持的版本（必需） |
| `viewed` | BigInteger | 浏览次数（默认0） |
| `templateFile` | Media | 模板文件 |

**场景分类（Scenario）**：
- Financial Performance（财务绩效）
- Revenue Optimization（收入优化）
- Operational Excellence（运营卓越）
- Customer Experience（客户体验）
- Supply Chain Intelligence（供应链智能）
- Workforce Analytics（劳动力分析）
- Quality Assurance（质量保证）
- Strategic Planning（战略规划）

**行业分类（Industry）**：
- General Business（通用业务）
- Learning（学习）
- Manufacturing（制造）
- Retail（零售）
- E-commerce（电商）
- Healthcare（医疗）
- Real Estate（房地产）
- Logistics（物流）
- Financial（金融）
- Energy & Utilities（能源与公用事业）
- Tutorials & Learning（教程与学习）
- Energy（能源）
- Utilities（公用事业）
- Education（教育）

**SEO组件**：
- `metaTitle` (String): SEO标题
- `metaDescription` (Text): SEO描述
- `shareImage` (Media): 分享图片

**标签组件**：
- `tag` (String): 标签文本

---

## 5. 启动与运行

### 5.1 开发模式

开发模式支持热重载，代码修改后自动重启：

```bash
npm run develop
```

启动后访问：
- **管理后台**: http://localhost:1337/admin
- **API**: http://localhost:1337/api

首次启动会提示创建管理员账号。

### 5.2 生产模式

生产模式需要先构建管理后台：

```bash
# 构建管理后台
npm run build

# 启动生产服务器
npm run start
```

### 5.3 数据初始化

系统提供了数据初始化脚本，可以导入示例数据：

```bash
npm run seed:example
```

**注意**：数据初始化只在首次运行时执行，如需重新初始化，需要先清空数据库。

### 5.4 首次使用

1. **启动服务**：运行 `npm run develop`
2. **创建管理员**：访问 http://localhost:1337/admin，填写管理员信息
3. **配置权限**：在管理后台的"设置" -> "用户和权限插件"中配置API权限
4. **创建内容**：在"内容管理器"中创建和管理内容

### 5.5 常用命令

```bash
# 开发模式（热重载）
npm run develop

# 生产模式启动
npm run start

# 构建管理后台
npm run build

# 数据初始化
npm run seed:example

# Strapi CLI命令
npm run strapi
```

---

## 6. API使用指南

### 6.1 RESTful API基础

Strapi提供了标准的RESTful API，所有API端点都以 `/api` 为前缀。

**API基础URL**：
```
http://localhost:1337/api
```

### 6.2 API端点

#### 6.2.1 Dictionary API

```http
# 获取所有字典
GET /api/dictionaries

# 获取单个字典
GET /api/dictionaries/:id

# 创建字典
POST /api/dictionaries
Content-Type: application/json

{
  "data": {
    "slug": "my-config",
    "content": {
      "key": "value"
    }
  }
}

# 更新字典
PUT /api/dictionaries/:id

# 删除字典
DELETE /api/dictionaries/:id
```

#### 6.2.2 Doc API

```http
# 获取所有文档
GET /api/docs

# 获取单个文档（包含关联的文档页面）
GET /api/docs/:id?populate=doc_pages

# 创建文档
POST /api/docs
Content-Type: application/json

{
  "data": {
    "url": "my-document",
    "title": "我的文档",
    "listed": true
  }
}

# 更新文档
PUT /api/docs/:id

# 删除文档
DELETE /api/docs/:id
```

#### 6.2.3 Doc Page API

```http
# 获取所有文档页面
GET /api/doc-pages

# 获取单个文档页面
GET /api/doc-pages/:id?populate=doc

# 创建文档页面
POST /api/doc-pages
Content-Type: application/json

{
  "data": {
    "url": "page-1",
    "title": "页面标题",
    "content": "# 内容\n这是Markdown格式的内容",
    "doc": 1  // 关联的文档ID
  }
}

# 更新文档页面
PUT /api/doc-pages/:id

# 删除文档页面
DELETE /api/doc-pages/:id
```

#### 6.2.4 Template API

```http
# 获取所有模板
GET /api/templates

# 获取单个模板（包含所有关联数据）
GET /api/templates/:id?populate=*

# 分页查询模板
GET /api/templates?pagination[page]=1&pagination[pageSize]=10

# 筛选查询
GET /api/templates?filters[template_status][$eq]=public&filters[product][$eq]=FineBI

# 排序查询
GET /api/templates?sort=createdAt:desc

# 创建模板
POST /api/templates
Content-Type: application/json

{
  "data": {
    "name": "销售报表模板",
    "template_status": "public",
    "template_link": "https://example.com/template",
    "author": "FanRuan",
    "scenario": "Revenue Optimization",
    "industry": "Retail",
    "language": "zh-tw",
    "product": "FineBI",
    "free": true,
    "featured": false,
    "download_link": "https://example.com/download",
    "supported_version": "5.1",
    "seo": {
      "metaTitle": "销售报表模板",
      "metaDescription": "专业的销售数据分析模板"
    },
    "tags": [
      {
        "tag": "销售"
      },
      {
        "tag": "报表"
      }
    ]
  }
}

# 更新模板
PUT /api/templates/:id

# 删除模板
DELETE /api/templates/:id
```

### 6.3 查询参数

#### 6.3.1 分页

```http
GET /api/templates?pagination[page]=1&pagination[pageSize]=25
```

#### 6.3.2 筛选

```http
# 等于
GET /api/templates?filters[name][$eq]=模板名称

# 包含
GET /api/templates?filters[name][$contains]=关键词

# 大于/小于
GET /api/templates?filters[price][$gt]=100

# 多个条件（AND）
GET /api/templates?filters[template_status][$eq]=public&filters[free][$eq]=true

# 多个条件（OR）
GET /api/templates?filters[$or][0][template_status][$eq]=public&filters[$or][1][template_status][$eq]=private
```

#### 6.3.3 排序

```http
# 升序
GET /api/templates?sort=createdAt:asc

# 降序
GET /api/templates?sort=createdAt:desc

# 多字段排序
GET /api/templates?sort=featured:desc,createdAt:desc
```

#### 6.3.4 关联数据（Populate）

```http
# 填充所有关联
GET /api/templates?populate=*

# 填充特定关联
GET /api/docs?populate=doc_pages

# 深度填充
GET /api/templates?populate[tags]=*&populate[seo][populate]=*
```

### 6.4 权限配置

#### 6.4.1 配置公共访问权限

在管理后台配置：
1. 进入"设置" -> "用户和权限插件" -> "角色"
2. 选择"Public"角色
3. 在"权限"中勾选需要公开访问的API操作

#### 6.4.2 使用API Token

```http
# 在请求头中添加Token
Authorization: Bearer your-api-token

GET /api/templates
Authorization: Bearer your-api-token
```

#### 6.4.3 使用JWT Token（用户认证）

```http
# 1. 登录获取Token
POST /api/auth/local
Content-Type: application/json

{
  "identifier": "user@example.com",
  "password": "password"
}

# 响应
{
  "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}

# 2. 使用Token访问受保护资源
GET /api/templates
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 6.5 文件上传

#### 6.5.1 上传文件

```http
POST /api/upload
Content-Type: multipart/form-data

file: [文件]
```

#### 6.5.2 关联文件到内容

在创建或更新内容时，可以通过ID关联已上传的文件：

```json
{
  "data": {
    "name": "模板名称",
    "thumbnail": 1  // 媒体文件ID
  }
}
```

---

## 7. 常见操作

### 7.1 创建内容条目

#### 7.1.1 通过管理后台创建

1. 登录管理后台：http://localhost:1337/admin
2. 进入"内容管理器"
3. 选择要创建的内容类型（如Template）
4. 点击"创建新条目"
5. 填写必填字段
6. 点击"保存"（保存为草稿）或"发布"

#### 7.1.2 通过API创建

参考 [6.2 API端点](#62-api端点) 章节中的示例。

### 7.2 管理媒体文件

#### 7.2.1 上传媒体文件

**管理后台**：
1. 进入"媒体库"
2. 点击"上传资源"
3. 选择文件上传

**API方式**：
```bash
curl -X POST http://localhost:1337/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "files=@/path/to/image.jpg"
```

#### 7.2.2 使用媒体文件

在创建内容时，可以通过以下方式关联媒体：
- 在管理后台：直接选择已上传的媒体
- 通过API：使用媒体文件的ID

### 7.3 配置权限

#### 7.3.1 配置API访问权限

1. 进入"设置" -> "用户和权限插件" -> "角色"
2. 选择要配置的角色（Public或Authenticated）
3. 在"权限"标签页中，展开对应的内容类型
4. 勾选允许的操作：
   - `find`: 查询列表
   - `findOne`: 查询单个
   - `create`: 创建
   - `update`: 更新
   - `delete`: 删除

#### 7.3.2 创建API Token

1. 进入"设置" -> "API Tokens"
2. 点击"创建新的API Token"
3. 填写名称和过期时间
4. 选择Token类型和权限
5. 保存后复制Token（只显示一次）

### 7.4 发布和草稿管理

#### 7.4.1 草稿和发布状态

- **草稿（Draft）**：内容已保存但未发布，前端API无法访问
- **已发布（Published）**：内容已发布，前端API可以访问

#### 7.4.2 发布内容

**管理后台**：
1. 编辑内容条目
2. 点击右上角的"发布"按钮
3. 确认发布

**API方式**：
```http
PUT /api/templates/:id
Content-Type: application/json

{
  "data": {
    "publishedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 7.4.3 取消发布

在管理后台点击"取消发布"按钮，或通过API将 `publishedAt` 设置为 `null`。

### 7.5 内容关系管理

#### 7.5.1 文档和文档页面的关系

1. 先创建Doc（文档）
2. 创建Doc Page（文档页面）时，选择关联的Doc
3. 一个Doc可以包含多个Doc Page

#### 7.5.2 模板的组件关系

模板使用了共享组件：
- **SEO组件**：每个模板必须有一个SEO配置
- **标签组件**：可以添加多个标签

在管理后台创建时，这些组件会以表单形式展示。

---

## 8. 配置说明

### 8.1 AWS S3文件上传配置

系统使用AWS S3作为文件存储服务，配置在 [config/plugins.js](config/plugins.js) 中。

#### 8.1.1 环境变量配置

```env
CDN_URL=https://your-cdn-url.com
CDN_ROOT_PATH=uploads
AWS_ACCESS_KEY_ID=your-access-key
AWS_ACCESS_SECRET=your-secret-key
AWS_REGION=us-east-1
AWS_BUCKET=your-bucket-name
AWS_ACL=public-read
AWS_SIGNED_URL_EXPIRES=900
```

#### 8.1.2 配置说明

- `CDN_URL`: CDN访问地址（可选）
- `CDN_ROOT_PATH`: 文件存储的根路径
- `AWS_ACCESS_KEY_ID`: AWS访问密钥ID
- `AWS_ACCESS_SECRET`: AWS访问密钥
- `AWS_REGION`: AWS区域
- `AWS_BUCKET`: S3存储桶名称
- `AWS_ACL`: 文件访问权限（public-read表示公开读取）
- `AWS_SIGNED_URL_EXPIRES`: 签名URL过期时间（秒，默认15分钟）

#### 8.1.3 本地开发（不使用S3）

如需在本地开发时使用本地存储，可以注释掉 [config/plugins.js](config/plugins.js) 中的upload配置，系统将使用默认的本地文件存储。

### 8.2 大文件上传支持

系统配置支持最大2GB的文件上传：

- **全局限制**: 2GB（在 [config/plugins.js](config/plugins.js) 中配置）
- **单次上传限制**: 500MB（在actionOptions中配置）
- **请求超时**: 30分钟（在 [config/server.js](config/server.js) 中配置）

### 8.3 CORS和安全策略

#### 8.3.1 CORS配置

CORS中间件已默认启用，允许跨域请求。如需自定义，可以在 [config/middlewares.js](config/middlewares.js) 中配置。

#### 8.3.2 内容安全策略（CSP）

系统配置了CSP策略，允许以下资源：
- 图片：`self`、`data:`、`blob:`、`https://intl-media.fanruan.com/`
- 媒体：`self`、`data:`、`blob:`、`https://intl-media.fanruan.com/`
- 连接：`self`、`https://intl-media.fanruan.com/`

如需添加其他域名，修改 [config/middlewares.js](config/middlewares.js) 中的CSP配置。

### 8.4 请求超时配置

在 [config/server.js](config/server.js) 中配置了30分钟的请求超时，以支持大文件上传：

```javascript
http: {
  serverOptions: {
    requestTimeout: 30 * 60 * 1000, // 30分钟
  },
}
```

### 8.5 数据库连接池配置

对于MySQL和PostgreSQL，可以配置连接池：

```env
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
```

---

## 9. 部署指南

### 9.1 生产环境准备

#### 9.1.1 环境变量

确保所有必需的环境变量都已正确配置，特别是：
- 所有密钥（APP_KEYS、JWT_SECRET等）
- 数据库连接信息
- AWS S3配置

#### 9.1.2 数据库迁移

如果使用MySQL或PostgreSQL，确保：
1. 数据库已创建
2. 数据库用户有足够权限
3. 运行迁移（Strapi会自动处理）

### 9.2 Docker部署

#### 9.2.1 使用Dockerfile

项目提供了 [Dockerfile](Dockerfile)，可以构建Docker镜像：

```bash
# 构建镜像
docker build -t fanruan-cms .

# 运行容器
docker run -d \
  -p 1337:1337 \
  --env-file .env \
  --name fanruan-cms \
  fanruan-cms
```

#### 9.2.2 使用Docker Compose

项目提供了 [docker-compose.yml](docker-compose.yml)：

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

**注意**：docker-compose.yml使用了`network_mode: "host"`，确保端口映射正确。

### 9.3 构建和启动

#### 9.3.1 构建管理后台

```bash
npm run build
```

构建完成后，管理后台的静态文件会生成在 `build` 目录。

#### 9.3.2 启动生产服务器

```bash
npm run start
```

或使用PM2等进程管理器：

```bash
pm2 start npm --name "fanruan-cms" -- start
```

### 9.4 环境变量管理

#### 9.4.1 使用.env文件

在项目根目录创建 `.env` 文件（不要提交到代码仓库）。

#### 9.4.2 使用环境变量管理工具

生产环境推荐使用：
- **Docker Secrets**: Docker环境
- **Kubernetes Secrets**: K8s环境
- **AWS Systems Manager Parameter Store**: AWS环境
- **HashiCorp Vault**: 企业级密钥管理

### 9.5 反向代理配置

#### 9.5.1 Nginx配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:1337;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 支持大文件上传
        client_max_body_size 2G;
        proxy_read_timeout 1800s;
        proxy_connect_timeout 1800s;
        proxy_send_timeout 1800s;
    }
}
```

#### 9.5.2 启用HTTPS

使用Let's Encrypt或其他SSL证书：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # ... 其他配置
}
```

### 9.6 监控和日志

#### 9.6.1 日志配置

Strapi的日志级别可以通过环境变量配置：

```env
LOG_LEVEL=info  # debug, info, warn, error
```

#### 9.6.2 健康检查

可以添加健康检查端点：

```http
GET /_health
```

---

## 10. 故障排查

### 10.1 常见问题

#### 10.1.1 启动失败：端口被占用

**问题**：`Error: listen EADDRINUSE: address already in use :::1337`

**解决方案**：
1. 检查是否有其他进程占用1337端口：
   ```bash
   lsof -i :1337
   ```
2. 修改端口：在 `.env` 中设置 `PORT=其他端口`
3. 或停止占用端口的进程

#### 10.1.2 数据库连接失败

**问题**：`Error: connect ECONNREFUSED`

**解决方案**：
1. 检查数据库服务是否运行
2. 验证数据库连接信息（主机、端口、用户名、密码）
3. 检查防火墙设置
4. 对于SQLite，检查文件权限

#### 10.1.3 文件上传失败

**问题**：上传文件时出错

**解决方案**：
1. 检查AWS S3配置是否正确
2. 验证AWS凭证是否有足够权限
3. 检查文件大小是否超过限制（2GB）
4. 查看服务器日志获取详细错误信息

#### 10.1.4 权限错误：403 Forbidden

**问题**：API返回403错误

**解决方案**：
1. 检查API权限配置（管理后台 -> 设置 -> 用户和权限插件）
2. 验证API Token或JWT Token是否有效
3. 检查Token是否过期
4. 确认角色权限设置正确

#### 10.1.5 构建失败

**问题**：`npm run build` 失败

**解决方案**：
1. 清除缓存：`rm -rf .cache build`
2. 重新安装依赖：`rm -rf node_modules && npm install`
3. 检查Node.js版本是否符合要求（>=18.0.0 <=22.x.x）
4. 查看详细错误信息

### 10.2 日志查看

#### 10.2.1 开发环境日志

开发模式下，日志会直接输出到控制台。

#### 10.2.2 生产环境日志

使用PM2查看日志：

```bash
pm2 logs fanruan-cms
```

使用Docker查看日志：

```bash
docker logs fanruan-cms
# 或
docker-compose logs -f
```

### 10.3 数据库问题

#### 10.3.1 SQLite数据库锁定

**问题**：`SQLITE_BUSY: database is locked`

**解决方案**：
1. 确保没有多个进程同时访问数据库
2. 检查数据库文件权限
3. 重启应用

#### 10.3.2 数据库迁移问题

**问题**：数据库结构不匹配

**解决方案**：
1. 备份现有数据
2. 删除数据库文件（SQLite）或清空表（MySQL/PostgreSQL）
3. 重新启动应用，Strapi会自动运行迁移

### 10.4 性能优化

#### 10.4.1 API响应慢

**优化建议**：
1. 使用分页限制返回数据量
2. 只查询需要的字段（使用`fields`参数）
3. 合理使用`populate`，避免过度关联
4. 添加数据库索引

#### 10.4.2 文件上传慢

**优化建议**：
1. 使用CDN加速文件访问
2. 考虑使用分片上传（需要自定义实现）
3. 优化网络连接

### 10.5 获取帮助

如果遇到无法解决的问题：

1. **查看Strapi官方文档**：https://docs.strapi.io
2. **查看项目日志**：获取详细错误信息
3. **检查GitHub Issues**：搜索类似问题
4. **联系技术支持**：提供错误日志和复现步骤

---

## 附录

### A. 有用的资源

- [Strapi官方文档](https://docs.strapi.io)
- [Strapi API文档](https://docs.strapi.io/dev-docs/api/rest)
- [Strapi GitHub](https://github.com/strapi/strapi)
- [Node.js文档](https://nodejs.org/docs)

### B. 项目文件参考

- [package.json](package.json) - 项目依赖和脚本
- [config/database.js](config/database.js) - 数据库配置
- [config/server.js](config/server.js) - 服务器配置
- [config/plugins.js](config/plugins.js) - 插件配置
- [src/api/template/content-types/template/schema.json](src/api/template/content-types/template/schema.json) - 模板数据模型

### C. 版本信息

- Strapi版本：5.29.0
- Node.js要求：>=18.0.0 <=22.x.x
- npm要求：>=6.0.0

---

**文档最后更新**：2024年

如有问题或建议，请联系项目维护者。

