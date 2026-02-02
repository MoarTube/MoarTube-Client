/**
 * Base Service Class
 *
 * Abstract base class that provides common functionality for all service classes.
 * Services should extend this class to inherit common utilities and patterns.
 */

import type { Logger } from '@/utils/logger.js';

/**
 * Abstract base service class
 */
export abstract class BaseService {
  protected readonly logger: Logger;

  constructor(_serviceName: string, logger: Logger) {
    this.logger = logger;
  }

  /**
   * Gets the current Unix timestamp in milliseconds
   */
  protected getCurrentTimestampMs(): number {
    return Date.now();
  }

  /**
   * Safely parses JSON with error handling
   */
  protected safeJsonParse<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Generate a unique ID 
   */
  protected generateId(length: number = 11): string {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
    let id = '';
    for (let i = 0; i < length; i++) {
      id += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return id;
  }
}
