export function notFound(_req, _res, next) { const error = new Error("Route not found"); error.status = 404; next(error); }
export function errorHandler(error, req, res, _next) {
  if (error.message === "Origin is not allowed") error.status = 403;
  const status = Number(error.status || error.statusCode) || 500;
  if (status >= 500) console.error(JSON.stringify({ level: "error", requestId: req.id, status, code: error.code || "INTERNAL_ERROR", method: req.method, path: req.path }));
  res.status(status).json({ error: { code: error.code || (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"), message: status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error" : error.message, ...(error.details ? { details: error.details } : {}), requestId: req.id } });
}
