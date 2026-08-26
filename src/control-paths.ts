import { relative, resolve, sep } from "node:path";

/** Local state that the filesystem scanner deliberately excludes from site content. */
export function isLocalXyleStatePath(sitePath: string): boolean {
  return (
    sitePath === "/.xyle.json" ||
    sitePath === "/.xyle" ||
    sitePath.startsWith("/.xyle/") ||
    sitePath.startsWith("/.xyle-stage-")
  );
}

/** Paths owned by Xyle rather than the published site. */
export function isControlSitePath(sitePath: string): boolean {
  return (
    isLocalXyleStatePath(sitePath) || sitePath === "/__xyle" || sitePath.startsWith("/__xyle/")
  );
}

/** Paths handled by the editor runtime and never by the static file server. */
export function isRuntimeSitePath(sitePath: string): boolean {
  return (
    isControlSitePath(sitePath) ||
    sitePath === "/edit" ||
    sitePath.startsWith("/edit/") ||
    sitePath === "/__xyle" ||
    sitePath.startsWith("/__xyle/")
  );
}

export function isPathInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}
