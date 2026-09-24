// Router factory for the hand-curated `workouts` / `diets` rows, looked up by
// normalised body type + goal: GET /:body_type/:goal
const express = require('express');
const db = require('../config/db');
const { normalizeBodyType, normalizeGoal } = require('../services/normalize');

// Parses and normalises :body_type / :goal, or responds 400.
function planParams(req, res, next) {
  const bodyType = normalizeBodyType(req.params.body_type);
  const goal = normalizeGoal(req.params.goal);
  if (!bodyType) return res.status(400).json({ message: 'Body type must be ectomorph, mesomorph or endomorph.' });
  if (!goal) return res.status(400).json({ message: 'Goal must be cut, bulk, lean bulk or maintenance.' });
  req.plan = { bodyType, goal };
  next();
}

function curatedPlanRouter(table, notFoundMessage) {
  const router = express.Router();
  router.get('/:body_type/:goal', planParams, async (req, res, next) => {
    try {
      const [rows] = await db.execute(
        `SELECT * FROM ${table} WHERE body_type = ? AND goal = ? ORDER BY id LIMIT 1`,
        [req.plan.bodyType, req.plan.goal]
      );
      if (rows.length === 0) return res.status(404).json({ message: notFoundMessage });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = curatedPlanRouter;
