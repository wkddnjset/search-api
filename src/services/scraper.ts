import * as cheerio from 'cheerio';

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  links: string[];
  error?: string;
}

export async function scrapeUrl(url: string, timeoutMs = 10000): Promise<ScrapedContent> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SearchAPI/1.0; +https://github.com/search-api)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return { url, title: '', text: '', links: [], error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return { url, title: '', text: '', links: [], error: `Not HTML: ${contentType}` };
    }

    const html = await res.text();
    return parseHtml(url, html);
  } catch (err: any) {
    return { url, title: '', text: '', links: [], error: err.message };
  }
}

function parseHtml(url: string, html: string): ScrapedContent {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, iframe, noscript, svg, [role="navigation"], [role="banner"], .sidebar, .nav, .menu, .footer, .header, .ad, .advertisement').remove();

  const title = $('title').text().trim() ||
    $('h1').first().text().trim() ||
    '';

  // Extract main content (try article/main first, fallback to body)
  let contentEl = $('article, main, [role="main"], .content, .post, .entry');
  if (contentEl.length === 0) {
    contentEl = $('body');
  }

  // Get text content, clean up whitespace
  const text = contentEl
    .text()
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 8000); // Limit to ~8KB for bot consumption

  // Extract links
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith('http') && links.length < 20) {
      links.push(href);
    }
  });

  return { url, title, text, links };
}

export async function scrapeUrls(
  urls: string[],
  concurrency = 3,
  timeoutMs = 10000,
): Promise<ScrapedContent[]> {
  const results: ScrapedContent[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((url) => scrapeUrl(url, timeoutMs)),
    );
    results.push(...batchResults);
  }

  return results;
}
