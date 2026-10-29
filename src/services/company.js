export const companyReportingEnabled =
  process.env.COMPANY_REPORTING_ENABLED === "true";
const tenantTables = new Set([
  "countries",
  "consultants",
  "consultant_country_history",
  "compensation_history",
  "expenses",
  "placements",
  "expense_conversions",
  "import_batches",
  "import_row_errors",
]);

// Explicit API scoping complements database RLS. Clients cannot supply ownership.
export function companyClient(client, companyId) {
  return new Proxy(client, {
    get(target, property) {
      if (property !== "from") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (table) => {
        const builder = target.from(table);
        if (!tenantTables.has(table)) return builder;
        return new Proxy(builder, {
          get(query, method) {
            if (["insert", "upsert"].includes(method))
              return (body, options) => {
                const own = (row) => ({ ...row, company_id: companyId });
                return query[method](
                  Array.isArray(body) ? body.map(own) : own(body),
                  options,
                );
              };
            if (["select", "update", "delete"].includes(method))
              return (...args) =>
                query[method](...args).eq("company_id", companyId);
            const value = Reflect.get(query, method);
            return typeof value === "function" ? value.bind(query) : value;
          },
        });
      };
    },
  });
}
