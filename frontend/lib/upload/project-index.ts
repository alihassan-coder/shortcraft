/**
 * What this browser remembers about each project: the uploaded source, the chosen vibe, a
 * first-frame poster, and jobs it started by hand (retries, re-plans).
 *
 * The backend has no "list sources / jobs of a project" route yet, so this is how the
 * dashboard and the processing screen find them. Projects made elsewhere still work: their
 * source id is read from the plan's storage keys.
 */
export type Vibe = "energetic" | "clean" | "story";

export type ProjectLocalInfo = {
  sourceId?: string;
  vibe?: Vibe;
  /** Small JPEG data URL of the first frame, captured before upload. */
  poster?: string;
  durationS?: number;
  /** Job ids started from this browser, newest wins over the chained ones. */
  jobs?: { transcribe?: string; plan?: string };
};

const KEY = "shortcraft.projects.v1";
type Index = Record<string, ProjectLocalInfo>;

const listeners = new Set<() => void>();
let cache: Index | null = null;
let cacheRaw: string | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(): Index {
  const store = storage();
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
  } catch {
    raw = null;
  }
  if (cache && raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    cache = parsed && typeof parsed === "object" ? (parsed as Index) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function writeIndex(next: Index) {
  cache = next;
  try {
    cacheRaw = JSON.stringify(next);
    storage()?.setItem(KEY, cacheRaw);
  } catch {
    // Quota or private mode: keep the in-memory copy for this session.
  }
  listeners.forEach((l) => l());
}

const EMPTY: Index = {};

export const projectIndex = {
  getAll: (): Index => (storage() ? readIndex() : EMPTY),
  get: (projectId: string): ProjectLocalInfo | undefined => readIndex()[projectId],
  update(projectId: string, patch: Partial<ProjectLocalInfo> | ((prev: ProjectLocalInfo) => ProjectLocalInfo)) {
    const all = readIndex();
    const prev = all[projectId] ?? {};
    const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
    writeIndex({ ...all, [projectId]: next });
  },
  remove(projectId: string) {
    const all = { ...readIndex() };
    delete all[projectId];
    writeIndex(all);
  },
  /** For useSyncExternalStore. Also picks up changes from other tabs. */
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  getServerSnapshot: (): Index => EMPTY,
};
