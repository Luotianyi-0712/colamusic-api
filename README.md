# 🎵 Cola 音乐聚合API

音乐API聚合，支持网易云音乐、酷我音乐、QQ音乐、酷狗音乐。

## 🚀 特性

- **多平台支持**: 网易云、QQ音乐、酷我、酷狗
- **高性能**: 多级缓存、连接池、并发控制
- **可靠性**: 健康检查、错误重试、熔断保护
- **监控**: 实时性能指标、结构化日志

## 📦 项目结构

```
src/
├── adapters/          # 平台适配器
├── core/              # 核心组件
├── lib/               # 工具库
└── types/             # 类型定义
```

## 🔌 API接口

### 搜索
```http
POST /search
{
  "platform": "netease",
  "keyword": "周杰伦",
  "limit": 10
}
```

### 跨平台搜索
```http
POST /search/all
{
  "keyword": "稻香",
  "platforms": ["netease", "qq"]
}
```

### 歌曲详情
```http
GET /song/{platform}/{songId}
```

### 歌词
```http
GET /lyric/{platform}/{songId}
```

### 监控
```http
GET /health    # 健康检查
GET /status    # 系统状态
GET /metrics   # 性能指标
```

## 🛠️ 安装运行

```bash
cd colamusic-api
npm install
npm start
```

服务启动在 `http://localhost:4055`

## 📊 平台状态

- ✅ **网易云音乐**: 正常工作
- ✅ **酷狗音乐**: 正常工作
- ⚠️ **QQ音乐**: 签名算法待更新
- ⚠️ **酷我音乐**: 搜索接口待更新

## 🔧 配置

编辑 `config.json` 配置各平台参数：

```json
{
  "platforms": {
    "netease": {
      "timeout": 15000,
      "retries": 3
    }
  }
}
```

## 📝 许可证

MIT License
