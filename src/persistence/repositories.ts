import { type Song, type Tuning } from "../schema/song.v1";
import { type Setlist } from "../schema/setlist";
import { type Settings } from "../schema/settings";
import {
  type PracticeSession,
  type HeatmapEntry,
  type ChordPairRecord,
  type StrumRecord,
} from "../schema/practice";
export interface SongRepository {
  all(): Promise<Song[]>;
  put(song: Song): Promise<void>;
  replace(songs: Song[]): Promise<void>;
}
export interface SetlistRepository {
  all(): Promise<Setlist[]>;
  put(set: Setlist): Promise<void>;
  replace(sets: Setlist[]): Promise<void>;
}
export interface PracticeRepository {
  sessions(): Promise<PracticeSession[]>;
  saveSession(session: PracticeSession): Promise<void>;
  heatmap(): Promise<HeatmapEntry[]>;
  saveHeat(entry: HeatmapEntry): Promise<void>;
  pairs(): Promise<ChordPairRecord[]>;
  savePair(record: ChordPairRecord): Promise<void>;
  strums(): Promise<StrumRecord[]>;
  saveStrum(record: StrumRecord): Promise<void>;
}
export interface SettingsRepository {
  get(): Promise<Settings>;
  put(settings: Settings): Promise<void>;
  tunings(): Promise<Tuning[]>;
  putTuning(tuning: Tuning): Promise<void>;
}
