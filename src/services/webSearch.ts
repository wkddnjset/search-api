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

// --- DuckDuckGo HTML Adapter (real web search, no API key needed) ---

const DDG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://duckduckgo.com/',
};

class DuckDuckGoSearchEngine implements SearchEngine {
  async search(query: WebSearchQuery): Promise<RawSearchResult[]> {
    const params = new URLSearchParams();
    params.set('q', query.q);
    if (query.search_lang) params.set('kl', query.search_lang);

    const safesearchMap = { off: '-2', moderate: '-1', strict: '1' } as const;
    params.set('kp', safesearchMap[query.safesearch]);

    if (query.freshness) {
      const freshnessMap: Record<string, string> = { pd: 'd', pw: 'w', pm: 'm', py: 'y' };
      params.set('df', freshnessMap[query.freshness] || '');
    }

    // Try lite endpoint first (works better from serverless/datacenter IPs)
    let results = await this.searchLite(params, query.count);
    if (results.length > 0) return results;

    // Fallback to html endpoint
    results = await this.searchHtml(params, query.count);
    return results;
  }

  private async searchLite(params: URLSearchParams, count: number): Promise<RawSearchResult[]> {
    try {
      const res = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: { ...DDG_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) return [];
      const html = await res.text();
      return this.parseLiteResults(html, count);
    } catch {
      return [];
    }
  }

  private async searchHtml(params: URLSearchParams, count: number): Promise<RawSearchResult[]> {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { ...DDG_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`DuckDuckGo error: ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    return this.parseHtmlResults(html, count);
  }

  private parseLiteResults(html: string, count: number): RawSearchResult[] {
    const results: RawSearchResult[] = [];

    // Lite version uses table rows: link in one row, snippet in next
    // Pattern: <a rel="nofollow" href="URL" class="result-link">TITLE</a>
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

    const links: { url: string; title: string }[] = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null && links.length < count) {
      links.push({
        url: match[1],
        title: match[2].replace(/<[^>]+>/g, '').trim(),
      });
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim());
    }

    for (let i = 0; i < links.length && results.length < count; i++) {
      let url = links[i].url;
      if (url.startsWith('//duckduckgo.com/l/?')) {
        const uddg = new URLSearchParams(url.replace('//duckduckgo.com/l/?', '')).get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      }
      if (!url.startsWith('http')) continue;

      results.push({
        title: links[i].title,
        url,
        snippet: snippets[i] || '',
      });
    }

    return results;
  }

  private parseHtmlResults(html: string, count: number): RawSearchResult[] {
    const results: RawSearchResult[] = [];
    const resultBlocks = html.split('class="result results_links');

    for (let i = 1; i < resultBlocks.length && results.length < count; i++) {
      const block = resultBlocks[i];
      const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)/);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (urlMatch && titleMatch) {
        let url = urlMatch[1];
        if (url.startsWith('//duckduckgo.com/l/?')) {
          const uddg = new URLSearchParams(url.replace('//duckduckgo.com/l/?', '')).get('uddg');
          if (uddg) url = decodeURIComponent(uddg);
        }

        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim()
          : '';

        results.push({ title: titleMatch[1].trim(), url, snippet });
      }
    }

    return results;
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
