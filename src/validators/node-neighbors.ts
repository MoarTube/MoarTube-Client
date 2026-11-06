import { z } from 'zod';

const neighborSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
      } catch {
        return false;
      }
    }, 'Use a complete http:// or https:// URL'),
  description: z.string().trim().min(1).max(1000),
});

export const setNodeNeighborsBodySchema = z.object({
  nodeNeighbors: z.array(neighborSchema).max(50),
});
