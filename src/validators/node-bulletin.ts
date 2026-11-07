import { z } from 'zod';

export const setNodeBulletinBodySchema = z.object({
  nodeBulletin: z.array(z.string().trim().min(1).max(1000)).max(10),
});
