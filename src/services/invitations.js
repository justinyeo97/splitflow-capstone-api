export const invitationsEnabled = process.env.CONSULTANT_INVITATIONS_ENABLED === 'true';
// People without a company can choose one they were invited to. Consultants can only view allowed data.
export function restrictConsultant(req, _res, next) {
  if (!invitationsEnabled) return next();
  const onboarding = ['/auth/profile', '/auth/companies', '/auth/join-company'];
  if (req.user.role === 'unassigned') {
    if (onboarding.includes(req.path)) return next();
  } else if (req.user.role === 'consultant') {
    if (onboarding.includes(req.path)) return next();
    if (req.method === 'GET' && (req.path === '/expenses' || /^\/expenses\/[0-9a-f-]+$/i.test(req.path) || req.path === '/countries' || req.path === '/consultants')) return next();
  } else return next();
  const error = new Error(req.user.role === 'unassigned' ? 'Select an invited company first' : 'Consultant accounts can only view their own expenses'); error.status = 403; next(error);
}

// When a consultant asks for expenses, only return expenses that belong to them.
export function consultantClient(client, consultantId) {
  return new Proxy(client, {
    get(target, property) {
      if (property !== 'from') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
      return table => {
        const builder = target.from(table);
        if (table !== 'expenses') return builder;
        return new Proxy(builder, {
          get(query, method) {
            // Knowing another expense ID does not let them see someone else's expense.
            if (method === 'select') return (...args) => query.select(...args).eq('consultant_id', consultantId);
            const value = Reflect.get(query, method); return typeof value === 'function' ? value.bind(query) : value;
          }
        });
      };
    }
  });
}
