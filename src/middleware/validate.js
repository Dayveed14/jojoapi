import { badRequest } from '../utils/errors.js';

/** Validate and replace req[source] with the parsed (stripped, coerced) value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return next(badRequest('Please check the highlighted fields.', { fields }));
  }
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  next();
};
