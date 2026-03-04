import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  apiKeys: (process.env.API_KEYS || '').split(',').filter(Boolean),
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
  searchEngine: {
    type: (process.env.SEARCH_ENGINE_TYPE || 'duckduckgo') as 'duckduckgo' | 'searxng' | 'brave' | 'mock',
    apiKey: process.env.SEARCH_ENGINE_API_KEY || '',
    baseUrl: process.env.SEARCH_ENGINE_BASE_URL,
  },
};
