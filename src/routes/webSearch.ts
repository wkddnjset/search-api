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

