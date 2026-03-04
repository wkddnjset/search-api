import { config } from '../config.js';
import type { WebSearchQuery, WebSearchResponse, WebSearchResult } from '../schemas/webSearch.js';
import { scrapeUrls } from './scraper.js';

// --- Search Engine Interface ---

interface SearchEngine {
  search(query: WebSearchQuery): Promise<RawSearchResult[]>;
}

interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  extraSnippets?: string[];
  datePublished?: string;
  language?: string;
}

// --- Shared Utilities ---

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// --- DuckDuckGo Adapter with cookie handling + Bing fallback ---

class DuckDuckGoSearchEngine implements SearchEngine {
  private debugLog: string[] = [];

  getDebugLog(): string[] {
    return this.debugLog;
  }

  async search(query: WebSearchQuery): Promise<RawSearchResult[]> {
    this.debugLog = [];

    // 1st: DDG JSON API with cookies
    let results = await this.searchDdgApi(query);
    if (results.length > 0) return results.slice(0, query.count);

    // 2nd: DDG Lite HTML
    results = await this.searchDdgLite(query);
    if (results.length > 0) return results.slice(0, query.count);

    // 3rd: Bing web scraping (most reliable from datacenter IPs)
    results = await this.searchBing(query);
    if (results.length > 0) return results.slice(0, query.count);

    // 4th: Google web scraping
    results = await this.searchGoogle(query);
    return results.slice(0, query.count);
  }

  private async searchDdgApi(query: WebSearchQuery): Promise<RawSearchResult[]> {
    try {
      // Step 1: GET duckduckgo.com to get cookies + vqd token
      const initRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query.q)}`, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      if (!initRes.ok) {
        this.debugLog.push(`ddg-api: init ${initRes.status}`);
        return [];
      }

      // Extract cookies from response
      const cookies = initRes.headers.getSetCookie?.() || [];
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

      const html = await initRes.text();
      const vqdMatch = html.match(/vqd=['"]?([\d][\d-]+[\d])['"]?/);
      if (!vqdMatch) {
        this.debugLog.push(`ddg-api: no vqd found (html length: ${html.length})`);
        return [];
      }

      // Step 2: Fetch results with cookies
      const params = new URLSearchParams({
        q: query.q,
        vqd: vqdMatch[1],
        kl: query.search_lang || 'wt-wt',
        l: query.search_lang || 'wt-wt',
        p: '',
        s: String(query.offset * query.count),
        ex: '-1',
        sp: '0',
        o: 'json',
      });

      const res = await fetch(`https://links.duckduckgo.com/d.js?${params}`, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': 'https://duckduckgo.com/',
          ...(cookieStr ? { 'Cookie': cookieStr } : {}),
        },
      });

      if (!res.ok) {
        this.debugLog.push(`ddg-api: d.js ${res.status}`);
        return [];
      }

      const data = await res.json();
      const items = data.results || data;
      if (!Array.isArray(items)) {
        this.debugLog.push(`ddg-api: not array`);
        return [];
      }

      const results: RawSearchResult[] = [];
      for (const item of items) {
        if (!item.u || !item.t || item.n) continue;
        results.push({
          title: decodeHtmlEntities(item.t),
          url: item.u,
          snippet: decodeHtmlEntities(item.a || ''),
        });
      }

      this.debugLog.push(`ddg-api: ${results.length} results`);
      return results;
    } catch (e: any) {
      this.debugLog.push(`ddg-api: error ${e.message}`);
      return [];
    }
  }

  private async searchDdgLite(query: WebSearchQuery): Promise<RawSearchResult[]> {
    try {
      const params = new URLSearchParams({ q: query.q });
      const res = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'User-Agent': BROWSER_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
        },
        body: params.toString(),
      });

      if (!res.ok) {
        this.debugLog.push(`ddg-lite: ${res.status}`);
        return [];
      }

      const html = await res.text();
      const results: RawSearchResult[] = [];
      const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

      const links: { url: string; title: string }[] = [];
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        links.push({ url: match[1], title: decodeHtmlEntities(match[2]) });
      }

      const snippets: string[] = [];
      while ((match = snippetRegex.exec(html)) !== null) {
        snippets.push(decodeHtmlEntities(match[1]));
      }

      for (let i = 0; i < links.length; i++) {
        let url = links[i].url;
        if (url.startsWith('//duckduckgo.com/l/?')) {
          const uddg = new URLSearchParams(url.replace('//duckduckgo.com/l/?', '')).get('uddg');
          if (uddg) url = decodeURIComponent(uddg);
        }
        if (!url.startsWith('http')) continue;
        results.push({ title: links[i].title, url, snippet: snippets[i] || '' });
      }

      this.debugLog.push(`ddg-lite: ${results.length} results (html: ${html.length})`);
      return results;
    } catch (e: any) {
      this.debugLog.push(`ddg-lite: error ${e.message}`);
      return [];
    }
  }

  private decodeBingUrl(url: string): string {
    // Bing wraps URLs: bing.com/ck/a?...&u=a1BASE64ENCODED_URL&ntb=1
    if (url.includes('bing.com/ck/a')) {
      try {
        const uParam = new URL(url.replace(/&amp;/g, '&')).searchParams.get('u');
        if (uParam && uParam.startsWith('a1')) {
          return Buffer.from(uParam.slice(2), 'base64').toString('utf-8');
        }
      } catch { /* fall through */ }
    }
    return url.replace(/&amp;/g, '&');
  }

  private async searchBing(query: WebSearchQuery): Promise<RawSearchResult[]> {
    try {
      const params = new URLSearchParams({
        q: query.q,
        count: String(query.count),
        FORM: 'QBLH',
      });

      const res = await fetch(`https://www.bing.com/search?${params}`, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!res.ok) {
        this.debugLog.push(`bing: ${res.status}`);
        return [];
      }

      const html = await res.text();
      const results: RawSearchResult[] = [];

      // Bing results are in <li class="b_algo">
      const blocks = html.split('<li class="b_algo"');
      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const urlMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"/);
        const titleMatch = block.match(/<a[^>]+href="https?:\/\/[^"]*"[^>]*>([\s\S]*?)<\/a>/);
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);

        if (urlMatch && titleMatch) {
          results.push({
            title: decodeHtmlEntities(titleMatch[1]),
            url: this.decodeBingUrl(urlMatch[1]),
            snippet: snippetMatch ? decodeHtmlEntities(snippetMatch[1]) : '',
          });
        }
      }

      this.debugLog.push(`bing: ${results.length} results (html: ${html.length})`);
      return results;
    } catch (e: any) {
      this.debugLog.push(`bing: error ${e.message}`);
      return [];
    }
  }

  private async searchGoogle(query: WebSearchQuery): Promise<RawSearchResult[]> {
    try {
      const params = new URLSearchParams({
        q: query.q,
        num: String(query.count),
        hl: 'en',
      });

      const res = await fetch(`https://www.google.com/search?${params}`, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!res.ok) {
        this.debugLog.push(`google: ${res.status}`);
        return [];
      }

      const html = await res.text();
      const results: RawSearchResult[] = [];

      // Google results pattern: <div class="g"> or data-hveid blocks
      // Look for <a href="/url?q=REAL_URL"> patterns
      const resultRegex = /<div class="[^"]*g[^"]*"[^>]*>[\s\S]*?<a href="\/url\?q=(https?[^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/g;
      let match;
      while ((match = resultRegex.exec(html)) !== null) {
        const url = decodeURIComponent(match[1]);
        if (url.startsWith('http')) {
          results.push({
            title: decodeHtmlEntities(match[2]),
            url,
            snippet: decodeHtmlEntities(match[3]),
          });
        }
      }

      // Fallback: simpler link extraction
      if (results.length === 0) {
        const linkRegex = /\/url\?q=(https?:\/\/(?!google|youtube\.google|maps\.google|accounts\.google)[^&"]+)/g;
        const seen = new Set<string>();
        while ((match = linkRegex.exec(html)) !== null && results.length < query.count) {
          const url = decodeURIComponent(match[1]);
          if (seen.has(url)) continue;
          seen.add(url);
          results.push({
            title: new URL(url).hostname,
            url,
            snippet: '',
          });
        }
      }

      this.debugLog.push(`google: ${results.length} results (html: ${html.length})`);
      return results;
    } catch (e: any) {
      this.debugLog.push(`google: error ${e.message}`);
      return [];
    }
  }
}

// --- SearXNG Adapter (self-hosted or public instance) ---

class SearXNGSearchEngine implements SearchEngine {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.searchEngine.baseUrl || 'http://localhost:8080';
  }

  async search(query: WebSearchQuery): Promise<RawSearchResult[]> {
    const params = new URLSearchParams();
    params.set('q', query.q);
    params.set('format', 'json');
    params.set('categories', 'general');
    params.set('pageno', String(query.offset + 1));

    const safesearchMap = { off: '0', moderate: '1', strict: '2' } as const;
    params.set('safesearch', safesearchMap[query.safesearch]);

    if (query.search_lang) {
      params.set('language', query.search_lang);
    }

    if (query.freshness) {
      const freshnessMap: Record<string, string> = { pd: 'day', pw: 'week', pm: 'month', py: 'year' };
      params.set('time_range', freshnessMap[query.freshness] || '');
    }

    const res = await fetch(`${this.baseUrl}/search?${params}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`SearXNG error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const results: any[] = data.results || [];

    return results.slice(0, query.count).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      datePublished: r.publishedDate || undefined,
      language: query.search_lang || undefined,
    }));
  }
}

// --- Mock Adapter (development/testing) ---

class MockSearchEngine implements SearchEngine {
  async search(query: WebSearchQuery): Promise<RawSearchResult[]> {
    const totalResults = 50;
    const start = query.offset * query.count;
    const results: RawSearchResult[] = [];

    for (let i = 0; i < query.count && start + i < totalResults; i++) {
      const idx = start + i + 1;
      results.push({
        title: `${query.q} - Result ${idx}`,
        url: `https://example.com/result-${idx}`,
        snippet: `This is a mock search result for "${query.q}". Result number ${idx}.`,
        extraSnippets: query.extra_snippets
          ? [
              `Additional context about "${query.q}" from result ${idx}.`,
              `More information related to "${query.q}".`,
            ]
          : undefined,
        datePublished: new Date(Date.now() - idx * 86400000).toISOString(),
        language: query.search_lang || 'en',
      });
    }

    return results;
  }
}

// --- Brave API Proxy Adapter ---

class BraveSearchEngine implements SearchEngine {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.searchEngine.baseUrl || 'https://api.search.brave.com/res/v1/web/search';
    this.apiKey = config.searchEngine.apiKey;
  }

  async search(query: WebSearchQuery): Promise<RawSearchResult[]> {
    const params = new URLSearchParams();
    params.set('q', query.q);
    if (query.country) params.set('country', query.country);
    if (query.search_lang) params.set('search_lang', query.search_lang);
    if (query.ui_lang) params.set('ui_lang', query.ui_lang);
    params.set('count', String(query.count));
    params.set('offset', String(query.offset));
    params.set('safesearch', query.safesearch);
    if (query.freshness) params.set('freshness', query.freshness);
    if (query.extra_snippets) params.set('extra_snippets', '1');

    const res = await fetch(`${this.baseUrl}?${params}`, {
      headers: { 'X-Subscription-Token': this.apiKey },
    });

    if (!res.ok) {
      throw new Error(`Brave API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const webResults = data.web?.results || [];

    return webResults.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      extraSnippets: r.extra_snippets,
      datePublished: r.age,
      language: r.language,
    }));
  }
}

// --- Factory ---

function createSearchEngine(): SearchEngine {
  switch (config.searchEngine.type) {
    case 'duckduckgo':
      return new DuckDuckGoSearchEngine();
    case 'searxng':
      return new SearXNGSearchEngine();
    case 'brave':
      return new BraveSearchEngine();
    case 'mock':
    default:
      return new MockSearchEngine();
  }
}

// --- Response Formatter ---

function formatAge(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function formatBraveResponse(
  query: WebSearchQuery,
  rawResults: RawSearchResult[],
): WebSearchResponse {
  const results: WebSearchResult[] = rawResults.map((r) => {
    const result: WebSearchResult = {
      title: r.title,
      url: r.url,
      description: r.snippet,
      family_friendly: true,
    };

    if (r.extraSnippets && r.extraSnippets.length > 0) {
      result.extra_snippets = r.extraSnippets.slice(0, 5);
    }

    const age = formatAge(r.datePublished);
    if (age) result.age = age;
    if (r.language) result.language = r.language;

    return result;
  });

  return {
    query: {
      original: query.q,
      altered: query.q,
      spellcheck_off: false,
      more_results_available: rawResults.length >= query.count,
    },
    mixed: {
      type: 'mixed',
      main: results.map((_, i) => ({ type: 'web', index: i, all: false })),
    },
    web: {
      type: 'search',
      results,
    },
  };
}

// --- Main Service ---

const engine = createSearchEngine();

export async function searchWeb(query: WebSearchQuery): Promise<WebSearchResponse> {
  const rawResults = await engine.search(query);
  const response = formatBraveResponse(query, rawResults);

  // Include debug info when results are empty (helps diagnose serverless issues)
  if (rawResults.length === 0 && engine instanceof DuckDuckGoSearchEngine) {
    (response as any)._debug = {
      engine: config.searchEngine.type,
      attempts: engine.getDebugLog(),
    };
  }

  // Scrape page content if requested
  if (query.scrape && response.web.results.length > 0) {
    const urlsToScrape = response.web.results
      .slice(0, query.scrape_count)
      .map((r) => r.url);

    const scraped = await scrapeUrls(urlsToScrape);

    for (const page of scraped) {
      const result = response.web.results.find((r) => r.url === page.url);
      if (result && page.text && !page.error) {
        result.page_content = {
          title: page.title,
          text: page.text,
          links: page.links,
        };
      }
    }
  }

  return response;
}
