/**
 * 音乐平台API - 核心类型定义
 */

// 平台枚举
export enum Platform {
  NETEASE = 'netease',
  QQ = 'qq',
  KUGOU = 'kugou',
  KUWO = 'kuwo'
}

// 音质枚举
export enum AudioQuality {
  STANDARD = 'standard',
  HIGH = 'high',
  LOSSLESS = 'lossless',
  HIRES = 'hires',
  MASTER = 'master'
}

// 搜索查询接口
export interface SearchQuery {
  keyword: string;
  limit?: number;
  offset?: number;
  type?: 'song' | 'album' | 'artist' | 'playlist';
  platform?: Platform;
}

// 统一搜索结果
export interface SearchResult {
  status: number;
  platform: Platform;
  total: number;
  hasMore: boolean;
  results: SongInfo[];
  cached?: boolean;
  responseTime?: number;
}

// 歌曲信息
export interface SongInfo {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumId?: string;
  picUrl: string;
  duration?: number;
  platform: Platform;
  // 平台特有字段
  platformData?: Record<string, any>;
}

// 歌曲详情
export interface SongDetail {
  status: number;
  platform: Platform;
  song: SongInfo;
  urls: AudioUrls;
  lyric: LyricData;
  cached?: boolean;
  responseTime?: number;
}

// 音频链接
export interface AudioUrls {
  [quality: string]: {
    url: string;
    bitrate: string;
    size?: string;
    format?: string;
  };
}

// 歌词数据
export interface LyricData {
  original: string;
  translated?: string;
  romanized?: string;
  timeline?: LyricTimeline[];
}

// 歌词时间轴
export interface LyricTimeline {
  time: number;
  text: string;
  translatedText?: string;
}

// HTTP配置
export interface HttpConfig {
  timeout: number;
  retries: number;
  retryDelay: number;
  maxSockets: number;
  keepAlive: boolean;
  headers?: Record<string, string>;
}

// 缓存配置
export interface CacheConfig {
  ttl: number;
  maxSize: number;
  strategy: 'LRU' | 'LFU' | 'FIFO';
  enableL1?: boolean;
  enableL2?: boolean;
}

// 限流配置
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

// 性能指标
export interface PerformanceMetrics {
  requestCount: number;
  averageResponseTime: number;
  errorRate: number;
  cacheHitRate: number;
  activeConnections: number;
  memoryUsage: number;
  cpuUsage: number;
  timestamp: number;
}

// 健康状态
export interface HealthStatus {
  platform: Platform;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  errorRate: number;
  lastCheck: number;
  details?: Record<string, any>;
}

// 错误类型接口
export interface ApiErrorData {
  code: string;
  message: string;
  platform?: Platform;
  details?: any;
  timestamp: number;
  retryable: boolean;
}

// 错误类
export class ApiError extends Error {
  public name: string = 'ApiError';
  public code: string;
  public platform?: Platform;
  public details?: any;
  public timestamp: number;
  public retryable: boolean;
  
  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    platform?: Platform,
    details?: any,
    retryable: boolean = true
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.platform = platform;
    this.details = details;
    this.timestamp = Date.now();
    this.retryable = retryable;
    
    // 确保错误堆栈正确
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  toJSON(): ApiErrorData {
    return {
      code: this.code,
      message: this.message,
      platform: this.platform,
      details: this.details,
      timestamp: this.timestamp,
      retryable: this.retryable,
    };
  }
}

// 批量请求
export interface BatchRequest<T> {
  requests: T[];
  maxConcurrency?: number;
  failFast?: boolean;
}

// 批量响应
export interface BatchResponse<T> {
  results: (T | ApiError)[];
  successCount: number;
  errorCount: number;
  totalTime: number;
}

// 适配器接口
export interface PlatformAdapter {
  readonly platform: Platform;
  readonly config: AdapterConfig;
  
  // 核心功能
  search(query: SearchQuery): Promise<SearchResult>;
  getSong(songId: string, quality?: AudioQuality): Promise<SongDetail>;
  getLyric(songId: string): Promise<LyricData>;
  
  // 批量处理
  batchSearch(queries: SearchQuery[]): Promise<BatchResponse<SearchResult>>;
  batchGetSongs(songIds: string[]): Promise<BatchResponse<SongDetail>>;
  
  // 健康检查
  healthCheck(): Promise<HealthStatus>;
  
  // 缓存管理
  warmupCache(items: string[]): Promise<void>;
  clearCache(pattern?: string): Promise<void>;
}

// 适配器配置
export interface AdapterConfig {
  http: HttpConfig;
  cache: CacheConfig;
  rateLimit: RateLimitConfig;
  cookies?: string;
  userAgent?: string;
  proxy?: string;
}

// 服务配置
export interface ServiceConfig {
  platforms: {
    [key in Platform]?: AdapterConfig;
  };
  cache: {
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
    memory: {
      maxSize: number;
      ttl: number;
    };
  };
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    alertThresholds: {
      responseTime: number;
      errorRate: number;
      memoryUsage: number;
    };
  };
  server: {
    port: number;
    host: string;
    cors: boolean;
    compression: boolean;
    rateLimiting: RateLimitConfig;
  };
}