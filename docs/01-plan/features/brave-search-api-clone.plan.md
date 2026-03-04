# Plan: Brave Web Search API Clone

> Brave Search API의 Web Search 엔드포인트와 동일한 기능을 가진 검색 API 구축

## 1. Overview

### 1.1 Feature Name
**search-api** - Brave Web Search API 호환 검색 서버

### 1.2 Problem Statement
Brave Search API의 Web Search(`/res/v1/web/search`)와 동일한 인터페이스를 제공하는 자체 검색 API가 필요합니다.

### 1.3 Goal
- Brave Web Search API와 호환되는 단일 엔드포인트 구축
- 동일한 파라미터, 응답 형식 지원
- API 키 기반 인증
- Rate Limiting

## 2. API 스펙

### 2.1 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/res/v1/web/search` | 웹 검색 |

### 2.2 인증
- **헤더**: `X-Subscription-Token: <API_KEY>`

### 2.3 요청 파라미터

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `q` | string | Y | - | 검색 쿼리 |
| `country` | string | N | - | 국가 코드 (ISO 3166-1 alpha-2) |
| `search_lang` | string | N | - | 검색 언어 (ISO 639-1) |
| `ui_lang` | string | N | - | UI 언어 |
| `count` | integer | N | 20 | 결과 수 (최대 20) |
| `offset` | integer | N | 0 | 페이지네이션 오프셋 (0-9) |
| `safesearch` | string | N | moderate | off, moderate, strict |
| `freshness` | string | N | - | pd(24h), pw(7d), pm(31d), py(1yr) |
| `extra_snippets` | boolean | N | false | 추가 발췌문 포함 (최대 5개) |

### 2.4 응답 구조

```json
{
  "query": {
    "original": "string",
    "altered": "string",
    "spellcheck_off": false,
    "more_results_available": true
  },
  "mixed": {
    "type": "mixed",
    "main": [
      { "type": "web", "index": 0, "all": false }
    ]
  },
  "web": {
    "type": "search",
    "results": [
      {
        "title": "string",
        "url": "string",
        "description": "string",
        "extra_snippets": ["string"],
        "age": "string",
        "language": "string",
        "family_friendly": true
      }
    ]
  }
}
```

### 2.5 에러 응답

```json
{
  "type": "ErrorResponse",
  "error": {
    "id": "VALIDATION_ERROR",
    "status": 422,
    "message": "Query parameter 'q' is required"
  }
}
```

| 상태 코드 | 설명 |
|-----------|------|
| 200 | 성공 |
| 401 | 인증 실패 (잘못된 API 키) |
| 422 | 파라미터 검증 실패 |
| 429 | Rate Limit 초과 |
| 500 | 서버 에러 |

## 3. 기술 스택

| 구분 | 기술 | 이유 |
|------|------|------|
| Runtime | Node.js (v20+) | 비동기 I/O |
| Framework | Express.js | 심플, 안정적 |
| Language | TypeScript | 타입 안전성 |
| Validation | Zod | 스키마 검증 |
| Rate Limit | express-rate-limit | 간단한 Rate Limiting |

## 4. 검색 데이터 소스

외부 검색 엔진 API를 백엔드로 사용하고, Brave Search API 형식으로 응답을 변환합니다.
- 검색 엔진 어댑터 패턴으로 다양한 소스 교체 가능하게 설계

## 5. 프로젝트 구조

```
search-api/
├── src/
│   ├── index.ts                    # 앱 진입점
│   ├── config.ts                   # 환경설정
│   ├── middleware/
│   │   ├── auth.ts                 # API 키 인증
│   │   ├── rateLimit.ts            # Rate Limiting
│   │   └── errorHandler.ts         # 에러 처리
│   ├── routes/
│   │   └── webSearch.ts            # /res/v1/web/search
│   ├── services/
│   │   └── webSearch.ts            # 검색 로직 + 엔진 어댑터
│   ├── schemas/
│   │   └── webSearch.ts            # 요청/응답 Zod 스키마
│   └── types/
│       └── index.ts                # TypeScript 타입
├── docs/
├── package.json
├── tsconfig.json
└── .env
```

## 6. 구현 체크리스트

- [ ] 프로젝트 초기 설정 (TypeScript + Express)
- [ ] API 키 인증 미들웨어
- [ ] Rate Limiting 미들웨어
- [ ] 요청 파라미터 검증 (Zod)
- [ ] 웹 검색 서비스 (검색 엔진 어댑터)
- [ ] Brave 호환 응답 포맷터
- [ ] 에러 핸들링
- [ ] Pagination 지원

## 7. 성공 기준

- [ ] `GET /res/v1/web/search?q=...` 정상 동작
- [ ] 모든 파라미터 지원 (q, country, search_lang, count, offset, freshness, safesearch, extra_snippets)
- [ ] Brave Search API와 동일한 응답 JSON 구조
- [ ] API 키 인증 동작
- [ ] Rate Limiting 동작
- [ ] 에러 응답 형식 일치

## 8. 참고 자료

- [Brave Web Search API 문서](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)
- [Brave Search API](https://brave.com/search/api/)
