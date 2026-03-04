import { z } from 'zod';

export const webSearchQuerySchema = z.object({
  q: z.string().min(1, "Query parameter 'q' is required"),
  country: z.string().length(2).optional(),
  search_lang: z.string().min(2).max(5).optional(),
  ui_lang: z.string().min(2).max(5).optional(),
  count: z.coerce.number().int().min(1).max(20).default(20),
  offset: z.coerce.number().int().min(0).max(9).default(0),
  safesearch: z.enum(['off', 'moderate', 'strict']).default('moderate'),
  freshness: z.enum(['pd', 'pw', 'pm', 'py']).optional(),
  extra_snippets: z.coerce.boolean().default(false),
  scrape: z.coerce.boolean().default(false),
  scrape_count: z.coerce.number().int().min(1).max(10).default(5),
});

export type WebSearchQuery = z.infer<typeof webSearchQuerySchema>;

export interface WebSearchResponse {
  query: {
    original: string;
    altered: string;
    spellcheck_off: boolean;
    more_results_available: boolean;
  };
  mixed: {
    type: 'mixed';
    main: Array<{ type: string; index: number; all: boolean }>;
  };
  web: {
    type: 'search';
    results: WebSearchResult[];
  };
}

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  extra_snippets?: string[];
  age?: string;
  language?: string;
  family_friendly: boolean;
  page_content?: {
    title: string;
    text: string;
    links: string[];
  };
}
