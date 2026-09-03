export function managedStyleCspPermits(
  source: string,
  initialPolicies: readonly string[],
  origin: string,
): boolean {
  const policies = [...initialPolicies];
  for (const tag of source.match(/<meta\b[^>]*>/gi) ?? []) {
    const httpEquiv = /http-equiv\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (httpEquiv?.toLowerCase() !== "content-security-policy") continue;
    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const content = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3];
    if (content) policies.push(content);
  }
  return policies.every((policy) => {
    const directives = new Map<string, string[]>();
    for (const directive of policy.split(";")) {
      const [name, ...values] = directive.trim().split(/\s+/);
      if (name) directives.set(name.toLowerCase(), values);
    }
    const sources =
      directives.get("style-src-elem") ??
      directives.get("style-src") ??
      directives.get("default-src");
    if (!sources || sources.length === 0) return true;
    if (sources.includes("'none'")) return false;
    if (sources.some((value) => value.startsWith("'nonce-") || value.startsWith("'sha"))) {
      return false;
    }
    return sources.some((value) => {
      if (value === "'self'") return true;
      try {
        return new URL(value).origin === origin;
      } catch {
        return false;
      }
    });
  });
}
