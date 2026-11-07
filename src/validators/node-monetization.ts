import { z } from 'zod';

export const addDonationAddressSchema = z
  .object({
    walletAddress: z.string().trim().min(1).max(1000),
    chain: z.enum(['ETH', 'BNB']),
    currency: z.enum(['ETH', 'BNB']),
  })
  .refine((value) => value.chain === value.currency, 'Choose the currency matching the chain');

export const deleteDonationAddressSchema = z.object({
  cryptoWalletAddressId: z.number().int().positive(),
});
