/**
 * Shared in-memory state for the posting process.
 * Works the same way as scrape-control.ts.
 */

let _shouldStop = false;
let _isRunning = false;
let _currentVin = "";
let _postsToday = 0;
let _lastPostTime: string | null = null;

export function getShouldStopPosting(): boolean {
  return _shouldStop;
}

export function setShouldStopPosting(value: boolean): void {
  _shouldStop = value;
}

export function getIsPostingRunning(): boolean {
  return _isRunning;
}

export function setIsPostingRunning(value: boolean): void {
  _isRunning = value;
}

export function getCurrentPostingVin(): string {
  return _currentVin;
}

export function setCurrentPostingVin(vin: string): void {
  _currentVin = vin;
}

export function getPostsToday(): number {
  return _postsToday;
}

export function setPostsToday(count: number): void {
  _postsToday = count;
}

export function incrementPostsToday(): number {
  _postsToday++;
  return _postsToday;
}

export function getLastPostTime(): string | null {
  return _lastPostTime;
}

export function setLastPostTime(time: string): void {
  _lastPostTime = time;
}
