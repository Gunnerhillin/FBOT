// Shared scraping control state
// Works because Next.js API routes share the same Node.js process in dev mode

let _shouldStop = false;

export function getShouldStop(): boolean {
  return _shouldStop;
}

export function setShouldStop(value: boolean): void {
  _shouldStop = value;
}
