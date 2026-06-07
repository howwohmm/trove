// shared types for trove — a personal taste-curation tool

export type Source = "picsum" | "unsplash" | "pexels";

// a candidate image to swipe on
export interface Candidate {
  id: string; // stable, prefixed by source e.g. "picsum-237"
  url: string; // display url (CDN, sized for cards)
  downloadUrl: string; // full-res url to save into the library
  width: number;
  height: number;
  author?: string;
  link?: string; // source page (attribution)
  tags?: string[]; // keywords from the source — drive taste-based retrieval
  source: Source;
}

export type SwipeDir = "like" | "skip";

export interface SwipeRecord {
  id: string;
  dir: SwipeDir;
  ts: number;
}

// an image saved into the personal library (file lives in /library)
export interface LibraryItem {
  id: string;
  file: string; // filename within /library, served via /api/img/[name]
  url: string; // original display url
  author?: string;
  link?: string;
  tags?: string[];
  source: Source;
  ts: number;
}

// user steering over generation
export interface Prefs {
  steer: string; // free-text direction injected into every generated prompt
  avoid: string; // free-text negatives — never generate these
}

export interface State {
  taste: number[] | null; // running-mean taste vector (unit-normalized)
  tasteCount: number; // number of likes folded into the taste vector
  prefs: Prefs;
  swipes: SwipeRecord[];
  library: LibraryItem[];
}
