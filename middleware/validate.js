// validate({ body, params, query }) — parses each part with its zod schema and
// replaces it with the parsed (normalised) value. Responds 400 on failure.

function formatIssues(error) {
  return error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
}

function validate(schemas) {
  return (req, res, next) => {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const details = formatIssues(result.error);
        return res.status(400).json({ error: details[0].message, details });
      }
      // Express 5 exposes req.query as a getter, so store parsed values separately.
      req.valid = req.valid || {};
      req.valid[part] = result.data;
    }
    return next();
  };
}

module.exports = { validate };
