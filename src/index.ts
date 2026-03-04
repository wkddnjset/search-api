import express from 'express';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { webSearchRouter } from './routes/webSearch.js';

const app = express();

app.use('/res/v1', authMiddleware);
app.use('/res/v1', rateLimitMiddleware);
app.use('/res/v1/web', webSearchRouter);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Search API server running on port ${config.port}`);
  console.log(`Search engine: ${config.searchEngine.type}`);
});

export default app;
