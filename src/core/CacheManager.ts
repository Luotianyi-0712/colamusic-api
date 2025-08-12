/**
 * 多级缓存管理器
 * 支持内存缓存(L1)、Redis缓存(L2)和智能缓存策略
 */

import { CacheConfig } from '../types';
import { logger } from '../lib/logger';

export interface CacheItem<T = any> {
  key: string;
  value: T;
  ttl: number;
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  memoryUsage: number;
}

/**
 * LRU内存缓存实现
 */
export class MemoryCache<T = any> {
  private cache = new Map<string, CacheItem<T>>();
  private accessOrder = new Map<string, number>();
  private config: CacheConfig;
  private stats = { hits: 0, misses: 0 };
  private accessCounter = 0;

  constructor(config: CacheConfig) {
    this.config = config;
    this.startCleanupTimer();
  }

  /**
   * 获取缓存项
   */
  get(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (this.isExpired(item)) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // 更新访问信息
    item.accessCount++;
    item.lastAccessed = Date.now();
    this.accessOrder.set(key, ++this.accessCounter);
    
    this.stats.hits++;
    return item.value;
  }

  /**
   * 设置缓存项
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const itemTtl = ttl || this.config.ttl;

    // 如果缓存已满，清理最少使用的项
    if (this.cache.size >= this.config.maxSize) {
      this.evictLeastUsed();
    }

    const item: CacheItem<T> = {
      key,
      value,
      ttl: itemTtl,
      createdAt: now,
      accessCount: 1,
      lastAccessed: now,
    };

    this.cache.set(key, item);
    this.accessOrder.set(key, ++this.accessCounter);
  }

  /**
   * 删除缓存项
   */
  delete(key: string): boolean {
    this.accessOrder.delete(key);
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.clear();
    this.accessCounter = 0;
  }

  /**
   * 检查键是否存在
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    return item !== undefined && !this.isExpired(item);
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      size: this.cache.size,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * 检查项是否过期
   */
  private isExpired(item: CacheItem<T>): boolean {
    return Date.now() - item.createdAt > item.ttl;
  }

  /**
   * 清理最少使用的项
   */
  private evictLeastUsed(): void {
    let lruKey: string | null = null;
    let lruOrder = Infinity;

    for (const [key, order] of this.accessOrder) {
      if (order < lruOrder) {
        lruOrder = order;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.delete(lruKey);
    }
  }

  /**
   * 清理过期项
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache) {
      if (now - item.createdAt > item.ttl) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.delete(key));
    
    if (expiredKeys.length > 0) {
      logger.debug(`Cleaned up ${expiredKeys.length} expired cache items`);
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpired();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 估算内存使用量
   */
  private estimateMemoryUsage(): number {
    let size = 0;
    for (const [key, item] of this.cache) {
      size += key.length * 2; // 字符串按UTF-16计算
      size += JSON.stringify(item.value).length * 2;
      size += 64; // 对象开销
    }
    return size;
  }
}

/**
 * 多级缓存管理器
 */
export class CacheManager {
  private l1Cache: MemoryCache;
  private l2Cache?: any; // Redis客户端，暂时用any
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
    this.l1Cache = new MemoryCache(config);
    
    // TODO: 初始化Redis缓存
    // this.initializeL2Cache();
  }

  /**
   * 获取缓存项（多级查找）
   */
  async get<T = any>(key: string): Promise<T | null> {
    // 先从L1缓存查找
    if (this.config.enableL1) {
      const l1Result = this.l1Cache.get(key) as T | null;
      if (l1Result !== null) {
        return l1Result;
      }
    }

    // 再从L2缓存查找
    if (this.config.enableL2 && this.l2Cache) {
      try {
        const l2Result = await this.getFromL2<T>(key);
        if (l2Result !== null) {
          // 回填到L1缓存
          if (this.config.enableL1) {
            this.l1Cache.set(key, l2Result);
          }
          return l2Result;
        }
      } catch (error) {
        logger.warn('L2 cache get failed:', error);
      }
    }

    return null;
  }

  /**
   * 设置缓存项（多级设置）
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    const promises: Promise<any>[] = [];

    // 设置L1缓存
    if (this.config.enableL1) {
      this.l1Cache.set(key, value, ttl);
    }

    // 设置L2缓存
    if (this.config.enableL2 && this.l2Cache) {
      promises.push(this.setToL2(key, value, ttl));
    }

    if (promises.length > 0) {
      try {
        await Promise.all(promises);
      } catch (error) {
        logger.warn('Cache set failed:', error);
      }
    }
  }

  /**
   * 删除缓存项
   */
  async delete(key: string): Promise<void> {
    const promises: Promise<any>[] = [];

    // 从L1缓存删除
    if (this.config.enableL1) {
      this.l1Cache.delete(key);
    }

    // 从L2缓存删除
    if (this.config.enableL2 && this.l2Cache) {
      promises.push(this.deleteFromL2(key));
    }

    if (promises.length > 0) {
      try {
        await Promise.all(promises);
      } catch (error) {
        logger.warn('Cache delete failed:', error);
      }
    }
  }

  /**
   * 批量获取
   */
  async mget<T = any>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const l2Keys: string[] = [];

    // 先从L1缓存批量获取
    if (this.config.enableL1) {
      for (const key of keys) {
        const value = this.l1Cache.get(key) as T | null;
        if (value !== null) {
          result.set(key, value);
        } else {
          l2Keys.push(key);
        }
      }
    } else {
      l2Keys.push(...keys);
    }

    // 从L2缓存获取剩余的键
    if (l2Keys.length > 0 && this.config.enableL2 && this.l2Cache) {
      try {
        const l2Results = await this.mgetFromL2<T>(l2Keys);
        for (const [key, value] of l2Results) {
          result.set(key, value);
          // 回填到L1缓存
          if (this.config.enableL1) {
            this.l1Cache.set(key, value);
          }
        }
      } catch (error) {
        logger.warn('L2 cache mget failed:', error);
      }
    }

    return result;
  }

  /**
   * 批量设置
   */
  async mset<T = any>(items: Map<string, T>, ttl?: number): Promise<void> {
    const promises: Promise<any>[] = [];

    // 设置L1缓存
    if (this.config.enableL1) {
      for (const [key, value] of items) {
        this.l1Cache.set(key, value, ttl);
      }
    }

    // 设置L2缓存
    if (this.config.enableL2 && this.l2Cache) {
      promises.push(this.msetToL2(items, ttl));
    }

    if (promises.length > 0) {
      try {
        await Promise.all(promises);
      } catch (error) {
        logger.warn('Cache mset failed:', error);
      }
    }
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    const promises: Promise<any>[] = [];

    // 清空L1缓存
    if (this.config.enableL1) {
      this.l1Cache.clear();
    }

    // 清空L2缓存
    if (this.config.enableL2 && this.l2Cache) {
      promises.push(this.clearL2());
    }

    if (promises.length > 0) {
      try {
        await Promise.all(promises);
      } catch (error) {
        logger.warn('Cache clear failed:', error);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    return this.l1Cache.getStats();
  }

  /**
   * 预热缓存
   */
  async warmup(items: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    const itemMap = new Map<string, any>();
    let commonTtl: number | undefined;

    for (const item of items) {
      itemMap.set(item.key, item.value);
      if (!commonTtl) commonTtl = item.ttl;
    }

    await this.mset(itemMap, commonTtl);
    logger.info(`Cache warmed up with ${items.length} items`);
  }

  // L2缓存操作方法（Redis相关，暂时为空实现）
  private async getFromL2<T = any>(key: string): Promise<T | null> {
    // TODO: 实现Redis get操作
    return null;
  }

  private async setToL2<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    // TODO: 实现Redis set操作
  }

  private async deleteFromL2(key: string): Promise<void> {
    // TODO: 实现Redis delete操作
  }

  private async mgetFromL2<T = any>(keys: string[]): Promise<Map<string, T>> {
    // TODO: 实现Redis mget操作
    return new Map();
  }

  private async msetToL2<T = any>(items: Map<string, T>, ttl?: number): Promise<void> {
    // TODO: 实现Redis mset操作
  }

  private async clearL2(): Promise<void> {
    // TODO: 实现Redis clear操作
  }
}