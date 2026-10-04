/**
 * The design animates views in as you move between them. A server-rendered
 * first page is shown at once instead (no hidden content before scripts
 * load); entrance motion applies to client navigations after that.
 */
let appHydrated = false;

export function markAppHydrated() {
  appHydrated = true;
}

/** `initial` for a motion element: false (render settled) on the first page. */
export function entrance<T>(initial: T): T | false {
  return appHydrated ? initial : false;
}
