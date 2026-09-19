# Hubble · 个人导航

打开即用、华丽可定制的个人网址导航。所有配置**实时写回服务器**。

## 特性

- 🚀 **开屏即展示**：无遮罩、无中间页，大卡片墙直接铺满
- 🎨 **8 套主题**：午夜 / 极光 / 霓虹 / 日落 / 海洋 / 极简白 / 樱粉 / 森林
- 🔍 **⌘K 全局搜索**：模糊匹配名称、描述、域名
- 📊 **实时健康探测**：每张卡显示在线状态 + 响应延迟（5 分钟自动刷新）
- 🛠 **可视化设置**：独立的 `/settings` 页面，分组增删、字段显隐、主题切换、最大站点数
- 💾 **配置持久化**：所有更改写回 `sites.json`，多设备同步
- 🐳 **Docker 一行启动**：镜像约 60MB，无任何外部依赖

## 启动

### Docker（推荐）

```bash
cd nav-site
docker compose up -d
# 访问 http://localhost:8080
# 配置页 http://localhost:8080/settings
```

### 直接跑

```bash
cd nav-site
node server.js
# 访问 http://localhost:8080
```

## 目录

```
nav-site/
├── server.js          # Node 后端（零依赖）
├── index.html         # 首页（开屏即卡片墙）
├── settings.html      # 设置页
├── sites.json         # 全局配置（自动持久化）
├── assets/
│   ├── style.css      # 8 套主题 + 全部组件
│   ├── app.js         # 首页逻辑
│   └── settings.js    # 设置页逻辑
├── Dockerfile
└── docker-compose.yml
```

## 配置

通过浏览器访问 `/settings` 即可：

- **外观**：卡片尺寸（小/中/大/特大）、信息密度、最大站点数
- **卡片字段**：分别控制名称、域名、描述、延迟、状态的显隐
- **分组与站点**：增删改分组、增删改站点
- **主题**：8 套主题即时切换
- **数据管理**：导入/导出、立即探测、重置

所有更改通过 `PUT /api/sites` 立即写回服务器 `sites.json`。

## 健康探测

打开页面时，浏览器会调 `POST /api/probe`，服务端并发对每个站点发起 HEAD 请求、测量延迟，返回给前端展示。之后每 5 分钟自动重探。

可通过环境变量调整：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 8080 | HTTP 端口 |
| `PROBE_TIMEOUT` | 5000 | 单个站点探测超时（ms） |
| `PROBE_CONCURRENCY` | 8 | 并发探测数 |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sites` | 读取配置 |
| PUT | `/api/sites` | 覆盖配置（自动持久化） |
| POST | `/api/probe` | 探测一组 URL 的可达性 + 延迟 |

## 数据持久化

Docker 部署时，建议将 `sites.json` 挂载到宿主机：

```yaml
volumes:
  - ./data/sites.json:/app/sites.json
```

或者使用 `docker-compose.yml` 中已经配置的 `./data` 卷。
