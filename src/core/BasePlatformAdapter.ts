/**
 * 平台适配器基类 - 提供通用功能和接口规范
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
  ApiError
} from '../types';
import { HttpClient } from './HttpClient';
import { CacheManager } from './CacheManager';
import { logger } from '../lib/logger';

export abstract class BasePlatformAdapter implements PlatformAdapter {
  public readonly platform: Platform;
  public readonly config: AdapterConfig;
  protected httpClient: HttpClient;
  protected cacheManager: CacheManager;
  private healthStatus: HealthStatus;

  constructor(platform: Platform, config: AdapterConfig) {
    this.platform = platform;
    this.config = config;
    this.httpClient = new HttpClient(config.http);
    this.cacheManager = new CacheManager(config.cache);
    
    this.healthStatus = {
      platform,
      status: 'healthy',
      responseTime: 0,
      errorRate: 0,
      lastCheck: Date.now(),
    };
  }

  // 抽象方法 - 子类必须实现
  abstract search(query: SearchQuery): Promise<SearchResult>;
  abstract getSong(songId: string, quality?: AudioQuality): Promise<SongDetail>;
  abstract getLyric(songId: string): Promise<LyricData>;

  /**
   * 批量搜索实现
   */
  async batchSearch(queries: SearchQuery[]): Promise<BatchResponse<SearchResult>> {
    const startTime = Date.now();
    const results: (SearchResult | ApiError)[] = [];
    let successCount = 0;
    let errorCount = 0;

    // 使用信号量控制并发
    const maxConcurrency = this.config.http.maxSockets || 10;
    const semaphore = new Semaphore(maxConcurrency);

    const promises = queries.map(async (query, index) => {
      await semaphore.acquire();
      try {
        const result = await this.search(query);
        results[index] = result;
        successCount++;
      } catch (error) {
        results[index] = error as ApiError;
        errorCount++;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);

    return {
      results,
      successCount,
      errorCount,
      totalTime: Date.now() - startTime,
    };
  }

  /**
   * 批量获取歌曲实现
   */
  async batchGetSongs(songIds: string[]): Promise<BatchResponse<SongDetail>> {
    const startTime = Date.now();
    const results: (SongDetail | ApiError)[] = [];
    let successCount = 0;
    let errorCount = 0;

    const maxConcurrency = this.config.http.maxSockets || 10;
    const semaphore = new Semaphore(maxConcurrency);

    const promises = songIds.map(async (songId, index) => {
      await semaphore.acquire();
      try {
        const result = await this.getSong(songId);
        results[index] = result;
        successCount++;
      } catch (error) {
        results[index] = error as ApiError;
        errorCount++;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);

    return {
      results,
      successCount,
      errorCount,
      totalTime: Date.now() - startTime,
    };
  }

  /**
   * 健康检查实现
   */
  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();
    
    try {
      // 执行一个简单的搜索请求来检查健康状态
      await this.search({
        keyword: 'test',
        limit: 1,
        platform: this.platform,
      });

      const responseTime = Date.now() - startTime;
      const metrics = this.httpClient.getMetrics();

      this.healthStatus = {
        platform: this.platform,
        status: responseTime < 5000 && metrics.errorRate < 0.1 ? 'healthy' : 'degraded',
        responseTime,
        errorRate: metrics.errorRate,
        lastCheck: Date.now(),
        details: {
          requestCount: metrics.requestCount,
          averageResponseTime: metrics.averageResponseTime,
          cacheStats: this.cacheManager.getStats(),
        },
      };
    } catch (error) {
      this.healthStatus = {
        platform: this.platform,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        errorRate: 1,
        lastCheck: Date.now(),
        details: {
          error: (error as Error).message,
        },
      };
    }

    return this.healthStatus;
  }

  /**
   * 缓存预热
   */
  async warmupCache(items: string[]): Promise<void> {
    logger.info(`Starting cache warmup for ${this.platform} with ${items.length} items`);
    
    const warmupItems = [];
    for (const item of items) {
      try {
        // 根据item类型决定预热策略
        if (this.isSearchQuery(item)) {
          const result = await this.search({ keyword: item, platform: this.platform });
          warmupItems.push({
            key: this.generateCacheKey('search', item),
            value: result,
            ttl: this.config.cache.ttl,
          });
        } else {
          // 假设是歌曲ID
          const result = await this.getSong(item);
          warmupItems.push({
            key: this.generateCacheKey('song', item),
            value: result,
            ttl: this.config.cache.ttl,
          });
        }
      } catch (error) {
        logger.warn(`Failed to warmup cache for item: ${item}`, error);
      }
    }

    await this.cacheManager.warmup(warmupItems);
    logger.info(`Cache warmup completed for ${this.platform}`);
  }

  /**
   * 清理缓存
   */
  async clearCache(pattern?: string): Promise<void> {
    if (pattern) {
      // TODO: 实现模式匹配的缓存清理
      logger.info(`Clearing cache for ${this.platform} with pattern: ${pattern}`);
    } else {
      await this.cacheManager.clear();
      logger.info(`Cleared all cache for ${this.platform}`);
    }
  }

  /**
   * 生成缓存键
   */
  protected generateCacheKey(type: string, identifier: string, ...params: string[]): string {
    const parts = [this.platform, type, identifier, ...params];
    return parts.join(':');
  }

  /**
   * 从缓存获取数据
   */
  protected async getFromCache<T>(key: string): Promise<T | null> {
    try {
      return await this.cacheManager.get<T>(key);
    } catch (error) {
      logger.warn(`Cache get failed for key: ${key}`, error);
      return null;
    }
  }

  /**
   * 设置缓存数据
   */
  protected async setToCache<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl);
    } catch (error) {
      logger.warn(`Cache set failed for key: ${key}`, error);
    }
  }

  /**
   * 处理API错误
   */
  protected handleApiError(error: any, context: string): ApiError {
    const apiError = new ApiError(
      error.message || 'Platform API error',
      error.code || 'PLATFORM_ERROR',
      this.platform,
      {
        context,
        originalError: error,
      },
      this.isRetryableError(error)
    );

    logger.error(`${this.platform} API error in ${context}:`, apiError);
    return apiError;
  }

  /**
   * 判断错误是否可重试
   */
  protected isRetryableError(error: any): boolean {
    // 网络错误通常可以重试
    if (error.code === 'ECONNRESET' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNREFUSED') {
      return true;
    }

    // 5xx服务器错误可以重试
    if (error.response?.status >= 500) {
      return true;
    }

    // 429限流错误可以重试
    if (error.response?.status === 429) {
      return true;
    }

    return false;
  }

  /**
   * 判断是否为搜索查询
   */
  private isSearchQuery(item: string): boolean {
    // 简单的启发式判断：如果包含空格或中文字符，可能是搜索查询
    return /[\s\u4e00-\u9fff]/.test(item);
  }

  /**
   * 获取适配器指标
   */
  getMetrics() {
    return {
      platform: this.platform,
      http: this.httpClient.getMetrics(),
      cache: this.cacheManager.getStats(),
      health: this.healthStatus,
    };
  }

  /**
   * 销毁适配器
   */
  destroy(): void {
    this.httpClient.destroy();
    logger.info(`${this.platform} adapter destroyed`);
  }
}

/**
 * 信号量实现，用于控制并发数
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      this.permits--;
      resolve();
    }
  }
}