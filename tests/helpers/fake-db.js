export function createDbMock(matchers = []) {
  const calls = [];

  function resolveMatcher(sql, args) {
    for (const matcher of matchers) {
      const match = matcher.match;
      const ok =
        typeof match === 'string'
          ? sql.includes(match)
          : match instanceof RegExp
            ? match.test(sql)
            : typeof match === 'function'
              ? Boolean(match(sql, args))
              : false;
      if (ok) return matcher;
    }
    return null;
  }

  function makeExec(sql, args = []) {
    return {
      async first() {
        const matcher = resolveMatcher(sql, args);
        if (!matcher || !matcher.first) return null;
        return matcher.first(args, sql);
      },
      async all() {
        const matcher = resolveMatcher(sql, args);
        if (!matcher || !matcher.all) return { results: [] };
        return matcher.all(args, sql);
      },
      async run() {
        const matcher = resolveMatcher(sql, args);
        if (!matcher || !matcher.run) return { success: true };
        return matcher.run(args, sql);
      },
    };
  }

  return {
    calls,
    prepare(sql) {
      const statement = {
        bind(...args) {
          calls.push({ sql, args });
          return makeExec(sql, args);
        },
        ...makeExec(sql),
      };
      return statement;
    },
  };
}
