import { z } from 'zod';

export const signInBodySchema = z.object({
  username: z.string(),
  password: z.string(),
  moarTubeNodeIp: z.string(),
  moarTubeNodePort: z.coerce.number(),
});
