import { Backend } from './backend';
import { LocalStorageDb } from './db';
import { buildDemoDb } from './seed';

/** Loaded lazily by Api so the backend, validation and demo seed stay out of the initial bundle. */
export function createBackend(): Backend {
  return new Backend(new LocalStorageDb(), () => buildDemoDb());
}
