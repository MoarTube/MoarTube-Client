import { z } from 'zod';

const linkSchema = z.object({
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

export const setNodeLinksBodySchema = z.object({
  nodeLinks: z.array(linkSchema).max(10),
});
