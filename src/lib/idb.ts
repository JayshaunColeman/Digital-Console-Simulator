// Minimal IndexedDB store for user audio files so loaded players survive a reload.

const DB = 'dm3sim';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export interface StoredFile {
  name: string;
  data: ArrayBuffer;
}

export const putFile = (key: string, f: StoredFile) => tx('readwrite', (s) => s.put(f, key)).catch(() => undefined);
export const getFile = (key: string) => tx<StoredFile | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
export const delFile = (key: string) => tx('readwrite', (s) => s.delete(key)).catch(() => undefined);
