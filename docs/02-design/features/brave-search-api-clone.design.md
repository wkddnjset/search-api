# Design: Brave Web Search API Clone

> Plan 문서 기반 상세 설계 — `GET /res/v1/web/search`

## 1. 아키텍처

```
Client Request
    │
    ▼
┌──────────────────────┐
│   Express Server     │
│   (src/index.ts)     │
└──────────┬───────────┘
           │
    ┌──────▼──────┐
    │ Middleware   │
    │ Chain        │
    ├─────────────┤
    │ 1. auth     │  X-Subscription-Token 검증
    │ 2. rateLimit│  요청 제한
    │ 3. validate │  Zod 파라미터 검증
    └──────┬──────┘
           │
    ┌──────▼──────────────┐
    │ Route: webSearch    │
    │ GET /res/v1/web/    │
    │     search          │
    └──────┬──────────────┘
           │
    ┌──────▼──────────────┐
    │ Service: webSearch  │
    │ - 검색 엔진 어댑터  │
    │ - 응답 변환         │
    └──────┬──────────────┘
           │
    ┌──────▼──────────────┐
    │ Search Engine       │
    │ Adapter (교체 가능) │
    │ - Brave API Proxy   │
    │ - Google CSE        │
    │ - Bing API          │
    │ - Mock (개발용)     │
    └─────────────────────┘
```

## 2. 파일별 상세 설계

### 2.1 `src/index.ts` — 앱 진입점

```typescript
// 역할: Express 앱 생성, 미들웨어 등록, 서버 시작
// 의존: config, middleware/*, routes/*

import express from 'express';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { webSearchRouter } from './routes/webSearch';

const app = express();

// 미들웨어
app.use('/res/v1', authMiddleware);
app.use('/res/v1', rateLimitMiddleware);

// 라우트
app.use('/res/v1/web', webSearchRouter);

// 에러 핸들링
app.use(errorHandler);

app.listen(config.port);
```

### 2.2 `src/config.ts` — 환경설정

```typescript
// .env에서 로드
export const config = {
  port: number;                    // 서버 포트 (기본 3000)
  apiKeys: string[];               // 허용된 API 키 목록
  rateLimit: {
    windowMs: number;              // Rate Limit 윈도우 (기본 60000ms)
    max: number;                   // 윈도우당 최대 요청 수 (기본 100)
  };
  searchEngine: {
    type: 'brave' | 'google' | 'bing' | 'mock';  // 사용할 검색 엔진
    apiKey: string;                // 검색 엔진 API 키
    baseUrl?: string;              // 커스텀 베이스 URL
  };
};
```

**환경 변수 (.env)**:
```
PORT=3000
API_KEYS=key1,key2,key3
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
SEARCH_ENGINE_TYPE=brave
SEARCH_ENGINE_API_KEY=your-api-key
```

### 2.3 `src/middleware/auth.ts` — API 키 인증

```typescript
// 역할: X-Subscription-Token 헤더에서 API 키 추출 및 검증
// 실패 시: 401 에러 반환

export function authMiddleware(req, res, next): void {
  // 1. req.headers['x-subscription-token'] 추출
  // 2. config.apiKeys에 포함 여부 확인
  // 3. 없으면 → 401 { type: "ErrorResponse", error: { id: "UNAUTHORIZED", status: 401, message: "Invalid API key" } }
  // 4. 있으면 → next()
}
```

### 2.4 `src/middleware/rateLimit.ts` — Rate Limiting

```typescript
// 역할: API 키 기준 요청 수 제한
// 라이브러리: express-rate-limit
// 초과 시: 429 에러 반환

export const rateLimitMiddleware = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  keyGenerator: (req) => req.headers['x-subscription-token'],  // API 키 기준
  handler: (req, res) => {
    // 429 { type: "ErrorResponse", error: { id: "RATE_LIMITED", status: 429, message: "..." } }
  }
});
```

### 2.5 `src/middleware/errorHandler.ts` — 에러 처리

```typescript
// 역할: 모든 에러를 Brave 호환 형식으로 변환

// Brave 에러 응답 형식:
// {
//   "type": "ErrorResponse",
//   "error": {
//     "id": string,      // VALIDATION_ERROR, UNAUTHORIZED, RATE_LIMITED, INTERNAL_ERROR
//     "status": number,
//     "message": string
//   }
// }

export function errorHandler(err, req, res, next): void {
  // ZodError → 422 VALIDATION_ERROR
  // AuthError → 401 UNAUTHORIZED
  // RateLimitError → 429 RATE_LIMITED
  // 기타 → 500 INTERNAL_ERROR
}
```

### 2.6 `src/schemas/webSearch.ts` — Zod 스키마

```typescript
import { z } from 'zod';

// 요청 파라미터 스키마
export const webSearchQuerySchema = z.object({
  q: z.string().min(1, "Query parameter 'q' is required"),
  country: z.string().length(2).optional(),           // ISO 3166-1 alpha-2
  search_lang: z.string().min(2).max(5).optional(),   // ISO 639-1
  ui_lang: z.string().min(2).max(5).optional(),
  count: z.coerce.number().int().min(1).max(20).default(20),
  offset: z.coerce.number().int().min(0).max(9).default(0),
  safesearch: z.enum(['off', 'moderate', 'strict']).default('moderate'),
  freshness: z.enum(['pd', 'pw', 'pm', 'py']).optional(),
  extra_snippets: z.coerce.boolean().default(false),
});

export type WebSearchQuery = z.infer<typeof webSearchQuerySchema>;

// 응답 타입 (검증 없이 타입만 정의)
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
}
```

### 2.7 `src/routes/webSearch.ts` — 라우트

```typescript
// 역할: GET /search 요청 처리
// 의존: schemas/webSearch, services/webSearch

import { Router } from 'express';
import { webSearchQuerySchema } from '../schemas/webSearch';
import { searchWeb } from '../services/webSearch';

export const webSearchRouter = Router();

webSearchRouter.get('/search', async (req, res, next) => {
  // 1. Zod로 req.query 검증 → 실패 시 next(ZodError)
  // 2. searchWeb(validatedQuery) 호출
  // 3. 결과를 200 JSON으로 반환
});
```

### 2.8 `src/services/webSearch.ts` — 검색 서비스

```typescript
// 역할: 검색 엔진 호출 + Brave 호환 응답 변환
// 핵심: SearchEngine 인터페이스로 어댑터 패턴 적용

// --- 검색 엔진 인터페이스 ---
interface SearchEngine {
  search(query: WebSearchQuery): Promise<RawSearchResult[]>;
}

interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  datePublished?: string;
  language?: string;
}

// --- 어댑터 구현 ---

// Brave API 프록시 어댑터
class BraveSearchEngine implements SearchEngine { ... }

// Mock 어댑터 (개발/테스트용)
class MockSearchEngine implements SearchEngine { ... }

// --- 팩토리 ---
function createSearchEngine(type: string): SearchEngine { ... }

// --- 메인 서비스 함수 ---
export async function searchWeb(query: WebSearchQuery): Promise<WebSearchResponse> {
  // 1. createSearchEngine(config.searchEngine.type)
  // 2. engine.search(query) → RawSearchResult[]
  // 3. formatBraveResponse(query, rawResults) → WebSearchResponse
  //    - query.original = q
  //    - more_results_available 계산
  //    - extra_snippets 처리
  //    - mixed.main 생성
  // 4. 반환
}
```

### 2.9 `src/types/index.ts` — 공통 타입

```typescript
// 에러 타입
export class AppError extends Error {
  constructor(
    public id: string,       // VALIDATION_ERROR, UNAUTHORIZED, etc.
    public status: number,
    message: string
  ) { super(message); }
}

// Brave 에러 응답 타입
export interface ErrorResponse {
  type: 'ErrorResponse';
  error: {
    id: string;
    status: number;
    message: string;
  };
}
```

## 3. 구현 순서

| 순서 | 파일 | 설명 |
|------|------|------|
| 1 | `package.json`, `tsconfig.json`, `.env` | 프로젝트 초기화 |
| 2 | `src/config.ts` | 환경설정 로드 |
| 3 | `src/types/index.ts` | 공통 타입 정의 |
| 4 | `src/schemas/webSearch.ts` | Zod 스키마 정의 |
| 5 | `src/middleware/auth.ts` | 인증 미들웨어 |
| 6 | `src/middleware/rateLimit.ts` | Rate Limit 미들웨어 |
| 7 | `src/middleware/errorHandler.ts` | 에러 핸들러 |
| 8 | `src/services/webSearch.ts` | 검색 서비스 + 어댑터 |
| 9 | `src/routes/webSearch.ts` | 라우트 핸들러 |
| 10 | `src/index.ts` | 앱 조립 + 서버 시작 |

## 4. 의존성 패키지

```json
{
  "dependencies": {
    "express": "^4.21",
    "express-rate-limit": "^7.5",
    "zod": "^3.24",
    "dotenv": "^16.4"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "@types/express": "^5.0",
    "tsx": "^4.19"
  }
}
```

## 5. 검색 엔진 어댑터 상세

### 5.1 Mock 어댑터 (기본, 개발용)

외부 API 없이 동작 가능. 쿼리 기반으로 더미 결과를 생성합니다.

```typescript
class MockSearchEngine implements SearchEngine {
  async search(query: WebSearchQuery): Promise<RawSearchResult[]> {
    // query.q 기반으로 count개의 더미 결과 생성
    // offset 적용
    // freshness, safesearch 시뮬레이션
  }
}
```

### 5.2 Brave API 프록시 어댑터

실제 Brave Search API를 프록시로 호출합니다.

```typescript
class BraveSearchEngine implements SearchEngine {
  // baseUrl: https://api.search.brave.com/res/v1/web/search
  // 요청 → Brave API 호출 → RawSearchResult[] 변환
}
```

## 6. 테스트 시나리오

| # | 테스트 | 기대 결과 |
|---|--------|-----------|
| 1 | `GET /res/v1/web/search?q=test` (유효 키) | 200 + 웹 검색 결과 |
| 2 | `GET /res/v1/web/search?q=test` (키 없음) | 401 UNAUTHORIZED |
| 3 | `GET /res/v1/web/search` (q 없음) | 422 VALIDATION_ERROR |
| 4 | `GET /res/v1/web/search?q=test&count=5` | 200 + 5개 결과 |
| 5 | `GET /res/v1/web/search?q=test&offset=3` | 200 + offset 적용 |
| 6 | `GET /res/v1/web/search?q=test&extra_snippets=true` | 200 + extra_snippets 포함 |
| 7 | `GET /res/v1/web/search?q=test&safesearch=strict` | 200 + 필터링된 결과 |
| 8 | `GET /res/v1/web/search?q=test&freshness=pd` | 200 + 24시간 내 결과 |
| 9 | Rate Limit 초과 | 429 RATE_LIMITED |
| 10 | 검색 엔진 장애 | 500 INTERNAL_ERROR |
