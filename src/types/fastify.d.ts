// Fastify Request Augmentation
import type { AwilixContainer } from 'awilix';
import type { ContainerCradle } from '@/core/container.js';
import type { FastifyRequest, FastifySessionObject } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    container: AwilixContainer<ContainerCradle>;
  }

  interface Session {
      jwtToken?: string;
  }
}
