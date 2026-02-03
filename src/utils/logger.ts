/**
 * Logger Module
 *
 * Uses Pino for fast, structured logging.
 */

import pino from 'pino';
import pinoPretty from 'pino-pretty';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Whether to include timestamps */
  timestamps?: boolean;
  /** Custom prefix for log messages */
  prefix?: string;
  /** Whether to log to file (future implementation) */
  logToFile?: boolean;
  /** Path to log file (if logToFile is true) */
  logFilePath?: string;
}

/**
 * Logger class using Pino with pino-pretty
 *
 * Provides structured logging with configurable levels and pretty formatting.
 */
export class Logger {
  private static instance: Logger | null = null;
  private readonly logger: pino.Logger;

  constructor(config: LoggerConfig = {}, existingLogger?: pino.Logger) {
    if (existingLogger) {
      this.logger = existingLogger;
    } else {
      const stream = pinoPretty({
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: (config.prefix !== undefined && config.prefix !== '') ? `[${config.prefix}] {msg}` : '{msg}',
      });

      this.logger = pino(
        {
          level: config.level ?? LogLevel.DEBUG, // Default to debug for client
          base: null, // Remove pid and hostname
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        stream as unknown as pino.DestinationStream
      );
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: LoggerConfig): Logger {
    Logger.instance ??= new Logger(config);
    return Logger.instance;
  }

  /**
   * Create a child logger with bound properties
   */
  public child(bindings: pino.Bindings): Logger {
    return new Logger({}, this.logger.child(bindings));
  }

  public debug(message: string, ...args: unknown[]): void {
    this.logger.debug(message, ...args);
  }

  public info(message: string, ...args: unknown[]): void {
    this.logger.info(message, ...args);
  }

  public warn(message: string, ...args: unknown[]): void {
    this.logger.warn(message, ...args);
  }

  public error(message: string, error?: unknown, ...args: unknown[]): void {
    if (error instanceof Error) {
      this.logger.error({ err: error }, message, ...args);
    } else {
      this.logger.error({ err: error }, message, ...args);
    }
  }
}

/**
 * Helper to get logger instance
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}
