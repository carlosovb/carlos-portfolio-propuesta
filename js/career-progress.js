((root) => {
  const levels =
    typeof module === "object" && module.exports
      ? require("./career-data.js")
      : root.CareerLevels;
  const next = {
    financial_trainee: ["financial_consultant"],
    financial_consultant: ["financial_consultant_senior_i", "team_manager"],
    financial_consultant_senior_i: ["financial_consultant_senior_ii"],
    team_manager: ["zone_coordinator"],
    zone_coordinator: ["agency_director"],
    agency_director: ["regional_director"],
    regional_director: ["national_director"],
  };
  function branch(id, directory) {
    const visited = new Set([id]),
      result = [],
      queue = [id];
    while (queue.length) {
      const parent = queue.shift();
      for (const person of directory) {
        if (person.manager_id === parent && !visited.has(person.user_id)) {
          visited.add(person.user_id);
          result.push(person);
          queue.push(person.user_id);
        }
      }
    }
    return result;
  }
  function calculate(member, directory, authorizedCounts = null, production = null) {
    const people = branch(member.user_id, directory);
    const ruleProgress = (rule) =>
      rule
        ? {
            units: ["quarter", "totalQuarter", "historical"]
              .filter((key) => rule[key] !== undefined)
              .map((key) => ({
                kind: key,
                required: rule[key],
                recorded: production ? Number(production[key] || 0) : null,
                missing: production
                  ? Math.max(0, rule[key] - Number(production[key] || 0))
                  : null,
                incomplete: !!production?.incomplete,
              })),
            team: (rule.team || []).map((requirement) => {
              const code = levels.find((l) => l.short === requirement.role).code;
              const observed = authorizedCounts
                ? Number(authorizedCounts[code] || 0)
                : people.filter((p) => p.position_code === code).length;
              return {
                ...requirement,
                observed,
                missing: Math.max(0, requirement.count - observed),
              };
            }),
          }
        : null;
    return (next[member.position_code] || []).map((code) => {
      const level = levels.find((l) => l.code === code);
      return { level, base: ruleProgress(level.base), extra: ruleProgress(level.extra) };
    });
  }
  const api = { branch, calculate };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CareerProgress = api;
})(typeof window === "object" ? window : globalThis);
