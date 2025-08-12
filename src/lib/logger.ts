/**
 * 日志系统
 * 支持多级别日志、结构化输出和性能监控
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: Error;
  duration?: number;
  requestId?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  filePath?: string;
  maxFileSize?: number;
  maxFiles?: number;
  enableStructured: boolean;
  enableColors: boolean;
}

class Logger {
  private config: LoggerConfig;
  private requestIdCounter = 0;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      enableStructured: false,
      enableColors: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      ...config,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp;
    const level = LogLevel[entry.level];
    const message = entry.message;
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const duration = entry.duration ? ` (${entry.duration}ms)` : '';
    const requestId = entry.requestId ? ` [${entry.requestId}]` : '';

    if (this.config.enableStructured) {
      return JSON.stringify(entry);
    }

    let formatted = `${timestamp} [${level}]${requestId} ${message}${context}${duration}`;

    if (this.config.enableColors && this.config.enableConsole) {
      const colors = {
        [LogLevel.DEBUG]: '\x1b[36m', // Cyan
        [LogLevel.INFO]: '\x1b[32m',  // Green
        [LogLevel.WARN]: '\x1b[33m',  // Yellow
        [LogLevel.ERROR]: '\x1b[31m', // Red
        [LogLevel.FATAL]: '\x1b[35m', // Magenta
      };
      const reset = '\x1b[0m';
      formatted = `${colors[entry.level]}${formatted}${reset}`;
    }

    return formatted;
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error,
    duration?: number,
    requestId?: string
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
      duration,
      requestId,
    };
  }

  private writeLog(entry: LogEntry): void {
    const formatted = this.formatMessage(entry);

    if (this.config.enableConsole) {
      if (entry.level >= LogLevel.ERROR) {
        console.error(formatted);
        if (entry.error) {
          console.error(entry.error.stack);
        }
      } else {
        console.log(formatted);
      }
    }

    // 文件日志功能可以后续扩展
    if (this.config.enableFile && this.config.filePath) {
      // TODO: 实现文件日志写入
    }
  }

  public debug(message: string, context?: Record<string, any>, requestId?: string): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    const entry = this.createLogEntry(LogLevel.DEBUG, message, context, undefined, undefined, requestId);
    this.writeLog(entry);
  }

  public info(message: string, context?: Record<string, any>, requestId?: string): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    const entry = this.createLogEntry(LogLevel.INFO, message, context, undefined, undefined, requestId);
    this.writeLog(entry);
  }

  public dev(message: string, context?: Record<string, any>, requestId?: string): void {
    // dev方法映射到debug级别
    this.debug(message, context, requestId);
  }

  public raw(message: string, context?: Record<string, any>, requestId?: string): void {
    // raw方法直接输出，不添加格式化
    if (this.config.enableConsole) {
      console.log(message);
    }
  }

  public warn(message: string, context?: Record<string, any> | unknown, requestId?: string): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    const contextObj = context && typeof context === 'object' && !Array.isArray(context) ?
      context as Record<string, any> :
      context ? { data: context } : undefined;
    const entry = this.createLogEntry(LogLevel.WARN, message, contextObj, undefined, undefined, requestId);
    this.writeLog(entry);
  }

  public error(message: string, error?: Error | unknown, context?: Record<string, any>, requestId?: string): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    const errorObj = error instanceof Error ? error : error ? new Error(String(error)) : undefined;
    const entry = this.createLogEntry(LogLevel.ERROR, message, context, errorObj, undefined, requestId);
    this.writeLog(entry);
  }

  public fatal(message: string, error?: Error | unknown, context?: Record<string, any>, requestId?: string): void {
    if (!this.shouldLog(LogLevel.FATAL)) return;
    const errorObj = error instanceof Error ? error : error ? new Error(String(error)) : undefined;
    const entry = this.createLogEntry(LogLevel.FATAL, message, context, errorObj, undefined, requestId);
    this.writeLog(entry);
  }

  public time(label: string, requestId?: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.info(`Timer: ${label}`, { duration }, requestId);
    };
  }

  public async timeAsync<T>(
    label: string,
    fn: () => Promise<T>,
    requestId?: string
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`Async Timer: ${label}`, { duration, success: true }, requestId);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(
        `Async Timer: ${label} failed`,
        error as Error,
        { duration, success: false },
        requestId
      );
      throw error;
    }
  }

  public generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestIdCounter}`;
  }

  public child(context: Record<string, any>): Logger {
    const childLogger = new Logger(this.config);
    const originalWriteLog = childLogger.writeLog.bind(childLogger);
    
    childLogger.writeLog = (entry: LogEntry) => {
      entry.context = { ...context, ...entry.context };
      originalWriteLog(entry);
    };

    return childLogger;
  }

  public setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  public getLevel(): LogLevel {
    return this.config.level;
  }
}

// 创建默认logger实例
export const logger = new Logger({
  level: LogLevel.INFO,
  enableConsole: true,
  enableColors: true,
  enableStructured: false,
});

// 导出Logger类供自定义使用
export { Logger };

// 便捷的性能监控装饰器
export function logPerformance(label?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const logLabel = label || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const requestId = logger.generateRequestId();
      return logger.timeAsync(logLabel, () => method.apply(this, args), requestId);
    };
  };
}

// HTTP请求日志中间件辅助函数
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}