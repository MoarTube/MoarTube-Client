import type { FastifyReply } from 'fastify';
import { Logger } from '@/utils/logger.js';

/**
 * Base Controller
 *
 * Abstract base class providing common functionality for all controllers.
 */
export abstract class BaseController {
  protected readonly controllerName: string;
  protected readonly logger: Logger;

  constructor(name: string) {
    this.controllerName = name;
    this.logger = Logger.getInstance();
  }

  protected sendSuccess(reply: FastifyReply, data?: object, status: number = 200): FastifyReply {
    const response = data ? { isError: false as const, ...data } : { isError: false as const };
    return reply.status(status).send(response);
  }

  protected sendError(reply: FastifyReply, message: string, status: number = 500): FastifyReply {
    return reply.status(status).send({ isError: true as const, message });
  }
}
