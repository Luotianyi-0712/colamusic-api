/**
 * 解决Node.js兼容性问题
 */

import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import path from "path";
import fs from "fs";
import http from "http";

import { 
  Platform, 
  AudioQuality, 
  ServiceConfig, 
  SearchQuery,
  AdapterConfig,
  HttpConfig,
  CacheConfig,
  RateLimitConfig
} from './types';
import { AdapterManager } from './core/AdapterManager';
import { logger } from './lib/logger';

// 默认配置
const defaultConfig: ServiceConfig = {
  platforms: {
    [Platform.NETEASE]: {
      http: {
        timeout: 15000,
        retries: 3,
        retryDelay: 1000,
        maxSockets: 50,
        keepAlive: true,
      } as HttpConfig,
      cache: {
        ttl: 300000, // 5分钟
        maxSize: 1000,
        strategy: 'LRU',
        enableL1: true,
        enableL2: false,
      } as CacheConfig,
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000, // 1分钟
      } as RateLimitConfig,
      cookies: '',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    } as AdapterConfig,
    [Platform.KUWO]: {
      http: {
        timeout: 15000,
        retries: 3,
        retryDelay: 1000,
        maxSockets: 50,
        keepAlive: true,
      } as HttpConfig,
      cache: {
        ttl: 300000,
        maxSize: 1000,
        strategy: 'LRU',
        enableL1: true,
        enableL2: false,
      } as CacheConfig,
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000,
      } as RateLimitConfig,
      cookies: '',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    } as AdapterConfig,
    [Platform.QQ]: {
      http: {
        timeout: 15000,
        retries: 3,
        retryDelay: 1000,
        maxSockets: 50,
        keepAlive: true,
      } as HttpConfig,
      cache: {
        ttl: 300000,
        maxSize: 1000,
        strategy: 'LRU',
        enableL1: true,
        enableL2: false,
      } as CacheConfig,
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000,
      } as RateLimitConfig,
      cookies: '',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    } as AdapterConfig,
    [Platform.KUGOU]: {
      http: {
        timeout: 15000,
        retries: 3,
        retryDelay: 1000,
        maxSockets: 50,
        keepAlive: true,
      } as HttpConfig,
      cache: {
        ttl: 300000,
        maxSize: 1000,
        strategy: 'LRU',
        enableL1: true,
        enableL2: false,
      } as CacheConfig,
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000,
      } as RateLimitConfig,
      cookies: '',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46',
    } as AdapterConfig,
  },
  cache: {
    memory: {
      maxSize: 100 * 1024 * 1024, // 100MB
      ttl: 300000,
    },
  },
  monitoring: {
    enabled: true,
    metricsInterval: 60000, // 1分钟
    alertThresholds: {
      responseTime: 5000, // 5秒
      errorRate: 0.1, // 10%
      memoryUsage: 512 * 1024 * 1024, // 512MB
    },
  },
  server: {
    port: 4055,
    host: "0.0.0.0",
    cors: true,
    compression: true,
    rateLimiting: {
      maxRequests: 1000,
      windowMs: 60000,
    } as RateLimitConfig,
  },
};

// 创建适配器管理器
const adapterManager = new AdapterManager(defaultConfig);

// 创建应用
const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))
  .use(staticPlugin({ 
    assets: path.join(process.cwd(), "temp_mpd"), 
    prefix: "/mpd" 
  }))

  // 健康检查
  .get("/", () => ({ 
    status: "OK", 
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    platforms: adapterManager.getAvailablePlatforms()
  }))

  // 系统状态
  .get("/status", async () => {
    const healthStatuses = await adapterManager.getHealthStatus();
    const metrics = adapterManager.getPerformanceMetrics();
    const adapterMetrics = adapterManager.getAllAdapterMetrics();

    return {
      status: "OK",
      health: Object.fromEntries(healthStatuses),
      performance: metrics,
      adapters: Object.fromEntries(adapterMetrics),
      timestamp: new Date().toISOString(),
    };
  })

  // ================= 统一搜索接口 =================
  .post("/search", async ({ body, set }) => {
    try {
      const { platform, keyword, limit, offset } = body as {
        platform: Platform;
        keyword: string;
        limit?: number;
        offset?: number;
      };

      if (!keyword) {
        set.status = 400;
        return { error: "keyword parameter is required" };
      }

      if (!platform) {
        set.status = 400;
        return { error: "platform parameter is required" };
      }

      const query: SearchQuery = {
        keyword,
        limit: limit || 10,
        offset: offset || 0,
        platform,
      };

      const result = await adapterManager.search(platform, query);
      return result;
    } catch (error: any) {
      set.status = 500;
      return { 
        status: 500, 
        error: error.message,
        platform: (body as any)?.platform 
      };
    }
  }, {
    body: t.Object({
      platform: t.Enum(Platform),
      keyword: t.String(),
      limit: t.Optional(t.Number()),
      offset: t.Optional(t.Number()),
    })
  })

  // 跨平台搜索
  .post("/search/all", async ({ body, set }) => {
    try {
      const { keyword, limit, offset, platforms } = body as {
        keyword: string;
        limit?: number;
        offset?: number;
        platforms?: Platform[];
      };

      if (!keyword) {
        set.status = 400;
        return { error: "keyword parameter is required" };
      }

      const query: SearchQuery = {
        keyword,
        limit: limit || 10,
        offset: offset || 0,
      };

      const results = await adapterManager.searchAll(query, platforms);
      
      // 转换Map为对象
      const response: Record<string, any> = {};
      for (const [platform, result] of results) {
        if (result instanceof Error) {
          response[platform] = { error: result.message };
        } else {
          response[platform] = result;
        }
      }

      return {
        status: 200,
        results: response,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      set.status = 500;
      return { status: 500, error: error.message };
    }
  }, {
    body: t.Object({
      keyword: t.String(),
      limit: t.Optional(t.Number()),
      offset: t.Optional(t.Number()),
      platforms: t.Optional(t.Array(t.Enum(Platform))),
    })
  })

  // ================= 歌曲详情接口 =================
  .get("/song/:platform/:songId", async ({ params, query, set }) => {
    try {
      const { platform, songId } = params;
      const { quality } = query as { quality?: AudioQuality };

      if (!Object.values(Platform).includes(platform as Platform)) {
        set.status = 400;
        return { error: "Invalid platform" };
      }

      const result = await adapterManager.getSong(
        platform as Platform, 
        songId, 
        quality || AudioQuality.STANDARD
      );
      
      return result;
    } catch (error: any) {
      set.status = 500;
      return { 
        status: 500, 
        error: error.message,
        platform: params.platform,
        songId: params.songId 
      };
    }
  })

  // ================= 歌词接口 =================
  .get("/lyric/:platform/:songId", async ({ params, set }) => {
    try {
      const { platform, songId } = params;

      if (!Object.values(Platform).includes(platform as Platform)) {
        set.status = 400;
        return { error: "Invalid platform" };
      }

      const result = await adapterManager.getLyric(platform as Platform, songId);
      
      return {
        status: 200,
        platform,
        songId,
        lyric: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      set.status = 500;
      return { 
        status: 500, 
        error: error.message,
        platform: params.platform,
        songId: params.songId 
      };
    }
  })

  // ================= 批量处理接口 =================
  .post("/batch/search", async ({ body, set }) => {
    try {
      const { platform, queries } = body as {
        platform: Platform;
        queries: SearchQuery[];
      };

      if (!platform || !queries || !Array.isArray(queries)) {
        set.status = 400;
        return { error: "platform and queries parameters are required" };
      }

      const result = await adapterManager.batchSearch(platform, queries);
      return result;
    } catch (error: any) {
      set.status = 500;
      return { status: 500, error: error.message };
    }
  }, {
    body: t.Object({
      platform: t.Enum(Platform),
      queries: t.Array(t.Object({
        keyword: t.String(),
        limit: t.Optional(t.Number()),
        offset: t.Optional(t.Number()),
      })),
    })
  })

  .post("/batch/songs", async ({ body, set }) => {
    try {
      const { platform, songIds } = body as {
        platform: Platform;
        songIds: string[];
      };

      if (!platform || !songIds || !Array.isArray(songIds)) {
        set.status = 400;
        return { error: "platform and songIds parameters are required" };
      }

      const result = await adapterManager.batchGetSongs(platform, songIds);
      return result;
    } catch (error: any) {
      set.status = 500;
      return { status: 500, error: error.message };
    }
  }, {
    body: t.Object({
      platform: t.Enum(Platform),
      songIds: t.Array(t.String()),
    })
  })

  // ================= 缓存管理接口 =================
  .post("/cache/warmup", async ({ body, set }) => {
    try {
      const { platform, items } = body as {
        platform: Platform;
        items: string[];
      };

      await adapterManager.warmupCache(platform, items);
      
      return {
        status: 200,
        message: `Cache warmed up for ${platform} with ${items.length} items`,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      set.status = 500;
      return { status: 500, error: error.message };
    }
  }, {
    body: t.Object({
      platform: t.Enum(Platform),
      items: t.Array(t.String()),
    })
  })

  .delete("/cache", async ({ query, set }) => {
    try {
      const { platform, pattern } = query as {
        platform?: Platform;
        pattern?: string;
      };

      await adapterManager.clearCache(platform, pattern);
      
      return {
        status: 200,
        message: platform ? 
          `Cache cleared for ${platform}` : 
          "All cache cleared",
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      set.status = 500;
      return { status: 500, error: error.message };
    }
  })

  // ================= 性能监控接口 =================
  .get("/metrics", () => {
    const metrics = adapterManager.getPerformanceMetrics();
    const adapterMetrics = adapterManager.getAllAdapterMetrics();
    
    return {
      performance: metrics,
      adapters: Object.fromEntries(adapterMetrics),
      timestamp: new Date().toISOString(),
    };
  })

  .get("/health", async () => {
    const healthStatuses = await adapterManager.getHealthStatus();
    
    return {
      status: "OK",
      platforms: Object.fromEntries(healthStatuses),
      timestamp: new Date().toISOString(),
    };
  });

// Node.js 兼容的服务器启动函数
async function startServer() {
  try {
    logger.info('🚀 Starting High-Performance Music API Server (Node.js Compatible)');
    
    // 使用 Elysia 的 fetch 方法创建 HTTP 服务器
    const server = http.createServer(async (req, res) => {
      try {
        // 构建请求对象
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        
        // 处理请求体
        let body: string | undefined = undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = await new Promise<string>((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk.toString());
            req.on('end', () => resolve(data));
          });
        }
        
        const request = new Request(url.toString(), {
          method: req.method,
          headers: req.headers as any,
          body: body,
        });

        // 使用 Elysia 处理请求
        const response = await app.fetch(request);
        
        // 设置响应头
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        
        // 发送响应体
        const responseText = await response.text();
        res.end(responseText);
        
      } catch (error: any) {
        logger.error('Request handling error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          status: 500, 
          error: 'Internal Server Error',
          message: error.message 
        }));
      }
    });

    // 启动服务器
    server.listen(defaultConfig.server.port, defaultConfig.server.host, () => {
      logger.info(`🚀 High-Performance Music API Server started`);
      logger.info(`📍 Server: http://${defaultConfig.server.host}:${defaultConfig.server.port}`);
      logger.info(`🎵 Available platforms: ${adapterManager.getAvailablePlatforms().join(', ')}`);
      logger.info(`📊 Monitoring: ${defaultConfig.monitoring.enabled ? 'Enabled' : 'Disabled'}`);
      
      // 输出API端点信息
      logger.info("📋 Available endpoints:");
      logger.info("  - POST /search - Single platform search");
      logger.info("  - POST /search/all - Cross-platform search");
      logger.info("  - GET /song/:platform/:songId - Get song details");
      logger.info("  - GET /lyric/:platform/:songId - Get song lyrics");
      logger.info("  - POST /batch/search - Batch search");
      logger.info("  - POST /batch/songs - Batch get songs");
      logger.info("  - GET /status - System status");
      logger.info("  - GET /health - Health check");
      logger.info("  - GET /metrics - Performance metrics");
    });

    // 优雅关闭处理
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      server.close(() => {
        adapterManager.destroy();
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      server.close(() => {
        adapterManager.destroy();
        process.exit(0);
      });
    });

    return server;
    
  } catch (error: any) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，启动服务器
if (require.main === module) {
  startServer();
}

export { app, startServer };
export default app;