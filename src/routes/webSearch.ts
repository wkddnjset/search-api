import { Router } from 'express';
import { webSearchQuerySchema } from '../schemas/webSearch.js';
import { searchWeb } from '../services/webSearch.js';

export const webSearchRouter = Router();

webSearchRouter.get('/search', async (req, res, next) => {
  try {
    const query = webSearchQuerySchema.parse(req.query);
    const result = await searchWeb(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Temporary debug endpoint to inspect raw HTML from search engines
webSearchRouter.get('/debug', async (req, res) => {
  const q = (req.query.q as string) || 'test';
  const engine = (req.query.engine as string) || 'bing';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  try {
    let url: string;
    let method = 'GET';
    let body: string | undefined;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (engine === 'bing') {
      url = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
    } else if (engine === 'google') {
      url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=5&hl=en`;
    } else if (engine === 'ddg') {
      url = 'https://lite.duckduckgo.com/lite/';
      method = 'POST';
      body = `q=${encodeURIComponent(q)}`;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      url = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
    }

    const fetchRes = await fetch(url, { method, headers, body, redirect: 'follow' });
    const html = await fetchRes.text();

    // Return a slice of the HTML for debugging
    res.json({
      engine,
      query: q,
      status: fetchRes.status,
      htmlLength: html.length,
      // Key patterns to check
      hasBAlgo: html.includes('b_algo'),
      hasResultLinks: html.includes('result-link'),
      hasResultSnippet: html.includes('result-snippet'),
      hasVqd: /vqd=/.test(html),
      hasGoogleResult: html.includes('/url?q='),
      // First 3000 chars of HTML body
      htmlSample: html.slice(0, 3000),
    });
  } catch (e: any) {
    res.json({ error: e.message });
  }
});
