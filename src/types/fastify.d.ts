// Fastify Request Augmentation
import type { AwilixContainer } from 'awilix';
import type { ContainerCradle } from '@/core/container.js';

declare module 'fastify' {
  interface FastifyRequest {
    container: AwilixContainer<ContainerCradle>;
  }

  interface Session {
      jwtToken?: string;
      user?: unknown; // Legacy property, cleared in settings but seemingly unused
  }
}
