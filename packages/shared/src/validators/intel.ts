import { z } from "zod";

export const intelSearchSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  company: z.string().optional(),
});

export type IntelSearch = z.infer<typeof intelSearchSchema>;

export const intelCompanySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  website: z.string().optional(),
  coingecko_id: z.string().nullable().optional(),
  github_org: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  twitter_handle: z.string().nullable().optional(),
  rss_feeds: z.array(z.string()).default([]),
});

export type IntelCompany = z.infer<typeof intelCompanySchema>;
