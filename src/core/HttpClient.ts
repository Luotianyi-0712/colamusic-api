/**
 * HTTP客户端 - 支持连接池、重试、缓存
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import http from 'http';
import https from 'https';
import { HttpConfig, ApiError } from '../types';
import { logger } from '../lib/logger';

export class HttpClient {
  private client: AxiosInstance;
  private config: HttpConfig;
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTime = 0;

  constructor(config: HttpConfig) {
    this.config = config;
    this.client = this.createClient();
  }

  private createClient(): AxiosInstance {
    // 创建HTTP/HTTPS代理，支持连接池
    const httpAgent = new http.Agent({
      keepAlive: this.config.keepAlive,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: Math.floor(this.config.maxSockets * 0.2),
      timeout: this.config.timeout,
      keepAliveMsecs: 1000,
    });

    const httpsAgent = new https.Agent({
      keepAlive: this.config.keepAlive,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: Math.floor(this.config.maxSockets * 0.2),
      timeout: this.config.timeout,
      keepAliveMsecs: 1000,
    });

    const client = axios.create({
      timeout: this.config.timeout,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        ...this.config.headers,
      },
    });

    // 请求拦截器
    client.interceptors.request.use(
      (config) => {
        config.metadata = { startTime: Date.now() };
        return config;
      },
      (error) => Promise.reject(error)
    );

    // 响应拦截器
    client.interceptors.response.use(
      (response) => {
        this.updateMetrics(response);
        return response;
      },
      (error) => {
        this.errorCount++;
        if (error.config?.metadata?.startTime) {
          const responseTime = Date.now() - error.config.metadata.startTime;
          this.totalResponseTime += responseTime;
        }
        return Promise.reject(error);
      }
    );

    return client;
  }

  private updateMetrics(response: AxiosResponse) {
    this.requestCount++;
    if (response.config.metadata?.startTime) {
      const responseTime = Date.now() - response.config.metadata.startTime;
      this.totalResponseTime += responseTime;
    }
  }

  /**
   * 发送GET请求，支持自动重试
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.requestWithRetry('GET', url, undefined, config);
  }

  /**
   * 发送POST请求，支持自动重试
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.requestWithRetry('POST', url, data, config);
  }

  /**
   * 发送PUT请求，支持自动重试
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.requestWithRetry('PUT', url, data, config);
  }

  /**
   * 发送DELETE请求，支持自动重试
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.requestWithRetry('DELETE', url, undefined, config);
  }

  /**
   * 带重试机制的请求
   */
  private async requestWithRetry<T = any>(
    method: string,
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    retryCount = 0
  ): Promise<T> {
    try {
      const response = await this.client.request({
        method,
        url,
        data,
        ...config,
      });

      return response.data;
    } catch (error: any) {
      const shouldRetry = this.shouldRetry(error, retryCount);
      
      if (shouldRetry) {
        const delay = this.calculateRetryDelay(retryCount);
        logger.warn(`Request failed, retrying in ${delay}ms. Attempt ${retryCount + 1}/${this.config.retries}`, {
          url,
          error: error.message,
        });
        
        await this.sleep(delay);
        return this.requestWithRetry(method, url, data, config, retryCount + 1);
      }

      throw this.createApiError(error, url);
    }
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(error: any, retryCount: number): boolean {
    if (retryCount >= this.config.retries) {
      return false;
    }

    // 网络错误或超时错误可以重试
    if (error.code === 'ECONNRESET' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND') {
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
   * 计算重试延迟（指数退避）
   */
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    const jitter = Math.random() * 1000; // 添加随机抖动
    return Math.min(exponentialDelay + jitter, 30000); // 最大30秒
  }

  /**
   * 创建统一的API错误
   */
  private createApiError(error: any, url: string): ApiError {
    return new ApiError(
      error.message || 'Unknown error occurred',
      error.code || 'UNKNOWN_ERROR',
      undefined,
      {
        url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      },
      this.shouldRetry(error, 0)
    );
  }

  /**
   * 批量请求处理
   */
  async batchRequest<T = any>(
    requests: Array<{
      method: string;
      url: string;
      data?: any;
      config?: AxiosRequestConfig;
    }>,
    maxConcurrency = 10
  ): Promise<Array<T | ApiError>> {
    const results: Array<T | ApiError> = [];
    const semaphore = new Semaphore(maxConcurrency);

    const promises = requests.map(async (request, index) => {
      await semaphore.acquire();
      try {
        const result = await this.requestWithRetry(
          request.method,
          request.url,
          request.data,
          request.config
        );
        results[index] = result;
      } catch (error) {
        results[index] = error as ApiError;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
      averageResponseTime: this.requestCount > 0 ? this.totalResponseTime / this.requestCount : 0,
    };
  }

  /**
   * 重置指标
   */
  resetMetrics() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.totalResponseTime = 0;
  }

  /**
   * 销毁客户端
   */
  destroy() {
    // 清理连接池
    if (this.client.defaults.httpAgent) {
      (this.client.defaults.httpAgent as http.Agent).destroy();
    }
    if (this.client.defaults.httpsAgent) {
      (this.client.defaults.httpsAgent as https.Agent).destroy();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

// 扩展AxiosRequestConfig类型
declare module 'axios' {
  interface AxiosRequestConfig {
    metadata?: {
      startTime: number;
    };
  }
}