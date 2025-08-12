/**
 * 适配管理器
 * 负责管理所有平台适配器，提供统一的服务接口
 */

import { 
  Platform, 
  PlatformAdapter, 
  AdapterConfig, 
  SearchQuery, 
  SearchResult, 
  SongDetail, 
  LyricData, 
  AudioQuality,
  BatchRequest,
  BatchResponse,
  HealthStatus,
  PerformanceMetrics,
  ServiceConfig
} from '../types';
import { NeteaseAdapter } from '../adapters/NeteaseAdapter';
import { KuwoAdapter } from '../adapters/KuwoAdapter';
import { QQMusicAdapter } from '../adapters/QQMusicAdapter';
import { KugouAdapter } from '../adapters/KugouAdapter';
import { logger } from '../lib/logger';

export class AdapterManager {
  private adapters = new Map<Platform, PlatformAdapter>();
  private config: ServiceConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private performanceMetrics: PerformanceMetrics;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.performanceMetrics = this.initializeMetrics();
    this.initializeAdapters();
    this.startHealthChecks();
    this.startMetricsCollection();
  }

  /**
   * 初始化所有适配器
   */
  private initializeAdapters(): void {
    // 初始化网易云音乐适配器
    if (this.config.platforms[Platform.NETEASE]) {
      try {
        const adapter = new NeteaseAdapter(this.config.platforms[Platform.NETEASE]);
        this.adapters.set(Platform.NETEASE, adapter);
        logger.info(`${Platform.NETEASE} adapter initialized`);
      } catch (error) {
        logger.error(`Failed to initialize ${Platform.NETEASE} adapter:`, error);
      }
    }

    // 初始化酷我音乐适配器
    if (this.config.platforms[Platform.KUWO]) {
      try {
        const adapter = new KuwoAdapter(this.config.platforms[Platform.KUWO]);
        this.adapters.set(Platform.KUWO, adapter);
        logger.info(`${Platform.KUWO} adapter initialized`);
      } catch (error) {
        logger.error(`Failed to initialize ${Platform.KUWO} adapter:`, error);
      }
    }

    // 初始化QQ音乐适配器
    if (this.config.platforms[Platform.QQ]) {
      try {
        const adapter = new QQMusicAdapter(this.config.platforms[Platform.QQ]);
        this.adapters.set(Platform.QQ, adapter);
        logger.info(`${Platform.QQ} adapter initialized`);
      } catch (error) {
        logger.error(`Failed to initialize ${Platform.QQ} adapter:`, error);
      }
    }

    // 初始化酷狗音乐适配器
    if (this.config.platforms[Platform.KUGOU]) {
      try {
        const adapter = new KugouAdapter(this.config.platforms[Platform.KUGOU]);
        this.adapters.set(Platform.KUGOU, adapter);
        logger.info(`${Platform.KUGOU} adapter initialized`);
      } catch (error) {
        logger.error(`Failed to initialize ${Platform.KUGOU} adapter:`, error);
      }
    }

    logger.info(`Initialized ${this.adapters.size} platform adapters`);
  }

  /**
   * 获取指定平台的适配器
   */
  getAdapter(platform: Platform): PlatformAdapter | null {
    return this.adapters.get(platform) || null;
  }

  /**
   * 获取所有可用的平台
   */
  getAvailablePlatforms(): Platform[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 搜索歌曲（单平台）
   */
  async search(platform: Platform, query: SearchQuery): Promise<SearchResult> {
    const adapter = this.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} not available`);
    }

    const startTime = Date.now();
    try {
      const result = await adapter.search(query);
      this.updateMetrics('search', Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.updateMetrics('search', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 跨平台搜索
   */
  async searchAll(query: SearchQuery, platforms?: Platform[]): Promise<Map<Platform, SearchResult | Error>> {
    const targetPlatforms = platforms || this.getAvailablePlatforms();
    const results = new Map<Platform, SearchResult | Error>();
    
    const promises = targetPlatforms.map(async (platform) => {
      try {
        const adapter = this.getAdapter(platform);
        if (adapter) {
          const result = await adapter.search(query);
          results.set(platform, result);
        }
      } catch (error) {
        results.set(platform, error as Error);
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * 获取歌曲详情
   */
  async getSong(platform: Platform, songId: string, quality?: AudioQuality): Promise<SongDetail> {
    const adapter = this.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} not available`);
    }

    const startTime = Date.now();
    try {
      const result = await adapter.getSong(songId, quality);
      this.updateMetrics('getSong', Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.updateMetrics('getSong', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(platform: Platform, songId: string): Promise<LyricData> {
    const adapter = this.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} not available`);
    }

    const startTime = Date.now();
    try {
      const result = await adapter.getLyric(songId);
      this.updateMetrics('getLyric', Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.updateMetrics('getLyric', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 批量搜索
   */
  async batchSearch(platform: Platform, queries: SearchQuery[]): Promise<BatchResponse<SearchResult>> {
    const adapter = this.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} not available`);
    }

    return adapter.batchSearch(queries);
  }

  /**
   * 批量获取歌曲
   */
  async batchGetSongs(platform: Platform, songIds: string[]): Promise<BatchResponse<SongDetail>> {
    const adapter = this.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} not available`);
    }

    return adapter.batchGetSongs(songIds);
  }

  /**
   * 获取所有平台的健康状态
   */
  async getHealthStatus(): Promise<Map<Platform, HealthStatus>> {
    const healthStatuses = new Map<Platform, HealthStatus>();
    
    const promises = Array.from(this.adapters.entries()).map(async ([platform, adapter]) => {
      try {
        const status = await adapter.healthCheck();
        healthStatuses.set(platform, status);
      } catch (error) {
        healthStatuses.set(platform, {
          platform,
          status: 'unhealthy',
          responseTime: 0,
          errorRate: 1,
          lastCheck: Date.now(),
          details: { error: (error as Error).message },
        });
      }
    });

    await Promise.allSettled(promises);
    return healthStatuses;
  }

  /**
   * 缓存预热
   */
  async warmupCache(platform: Platform, items: string[]): Promise<void> {
    const adapter = this.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} not available`);
    }

    await adapter.warmupCache(items);
  }

  /**
   * 清理缓存
   */
  async clearCache(platform?: Platform, pattern?: string): Promise<void> {
    if (platform) {
      const adapter = this.getAdapter(platform);
      if (adapter) {
        await adapter.clearCache(pattern);
      }
    } else {
      // 清理所有平台的缓存
      const promises = Array.from(this.adapters.values()).map(adapter => 
        adapter.clearCache(pattern)
      );
      await Promise.allSettled(promises);
    }
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * 获取所有适配器的指标
   */
  getAllAdapterMetrics(): Map<Platform, any> {
    const metrics = new Map();
    for (const [platform, adapter] of this.adapters) {
      if ('getMetrics' in adapter && typeof adapter.getMetrics === 'function') {
        metrics.set(platform, (adapter as any).getMetrics());
      }
    }
    return metrics;
  }

  /**
   * 启动健康检查
   */
  private startHealthChecks(): void {
    if (!this.config.monitoring.enabled) return;

    this.healthCheckInterval = setInterval(async () => {
      try {
        const healthStatuses = await this.getHealthStatus();
        
        for (const [platform, status] of healthStatuses) {
          if (status.status === 'unhealthy') {
            logger.warn(`Platform ${platform} is unhealthy:`, status.details);
          }
          
          // 检查告警阈值
          if (status.responseTime > this.config.monitoring.alertThresholds.responseTime) {
            logger.warn(`Platform ${platform} response time exceeded threshold: ${status.responseTime}ms`);
          }
          
          if (status.errorRate > this.config.monitoring.alertThresholds.errorRate) {
            logger.warn(`Platform ${platform} error rate exceeded threshold: ${status.errorRate}`);
          }
        }
      } catch (error) {
        logger.error('Health check failed:', error);
      }
    }, 30000); // 每30秒检查一次
  }

  /**
   * 启动性能指标收集
   */
  private startMetricsCollection(): void {
    if (!this.config.monitoring.enabled) return;

    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoring.metricsInterval);
  }

  /**
   * 收集性能指标
   */
  private collectMetrics(): void {
    // 收集内存使用情况
    const memoryUsage = process.memoryUsage();
    this.performanceMetrics.memoryUsage = memoryUsage.heapUsed;

    // 收集CPU使用情况（简化实现）
    this.performanceMetrics.cpuUsage = process.cpuUsage().user / 1000000; // 转换为秒

    // 更新时间戳
    this.performanceMetrics.timestamp = Date.now();

    // 检查内存使用告警
    if (this.performanceMetrics.memoryUsage > this.config.monitoring.alertThresholds.memoryUsage) {
      logger.warn(`Memory usage exceeded threshold: ${this.performanceMetrics.memoryUsage} bytes`);
    }
  }

  /**
   * 更新性能指标
   */
  private updateMetrics(operation: string, responseTime: number, success: boolean): void {
    this.performanceMetrics.requestCount++;
    
    if (success) {
      this.performanceMetrics.averageResponseTime = 
        (this.performanceMetrics.averageResponseTime * (this.performanceMetrics.requestCount - 1) + responseTime) / 
        this.performanceMetrics.requestCount;
    } else {
      // 错误率计算
      const errorCount = Math.floor(this.performanceMetrics.requestCount * this.performanceMetrics.errorRate) + 1;
      this.performanceMetrics.errorRate = errorCount / this.performanceMetrics.requestCount;
    }
  }

  /**
   * 初始化性能指标
   */
  private initializeMetrics(): PerformanceMetrics {
    return {
      requestCount: 0,
      averageResponseTime: 0,
      errorRate: 0,
      cacheHitRate: 0,
      activeConnections: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      timestamp: Date.now(),
    };
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    // 清理定时器
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // 销毁所有适配器
    for (const [platform, adapter] of this.adapters) {
      try {
        if ('destroy' in adapter && typeof adapter.destroy === 'function') {
          (adapter as any).destroy();
        }
        logger.info(`${platform} adapter destroyed`);
      } catch (error) {
        logger.error(`Failed to destroy ${platform} adapter:`, error);
      }
    }

    this.adapters.clear();
    logger.info('AdapterManager destroyed');
  }
}