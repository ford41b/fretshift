import { expect, it } from "vitest";
import { newSong, newMeasure, emptySlot } from "../../schema/song.v1";
import { compilePlayback } from "./index";
import {
  practiceTimeline,
  TimelineQueue,
  type PracticeTimeline,
} from "./timeline";
const shortPlan = (duration: number): PracticeTimeline => ({
  events: [
    {
      time: 0,
      duration,
      midi: 60,
      string: 0,
      slot: 0,
      measure: 0,
      muted: false,
    },
  ],
  clicks: [{ time: 0, accent: true, measure: 0, slot: 0 }],
  positions: [{ time: 0, measure: 0, slot: 0 }],
  duration,
  begin: 0,
  sourceQuarterOffset: 0,
});
it("prepares boundaries ahead without advancing the actual position", () => {
  const q = new TimelineQueue(shortPlan(1), 0, true),
    prepared: number[] = [],
    notes: number[] = [];
  q.tick(
    0.925,
    (_, t) => notes.push(t),
    () => {},
    (_, t) => {
      prepared.push(t);
    },
  );
  expect(prepared).toEqual([1]);
  expect(q.position(0.99).cycle).toBe(0);
  expect(q.position(1.001).cycle).toBe(1);
  expect(notes).toEqual([0, 1]);
});
it("keeps the current short loop while scheduling all future loops in lookahead", () => {
  const q = new TimelineQueue(shortPlan(0.025), 0, true);
  q.tick(
    0.001,
    () => {},
    () => {},
  );
  expect(q.position(0.001).cycle).toBe(0);
  expect(q.position(0.076).cycle).toBe(3);
});
it("uses each subsequent duration without duplicate boundary events", () => {
  const q = new TimelineQueue(shortPlan(2), 0, true),
    notes: number[] = [],
    clicks: number[] = [];
  for (let now = 0; now < 4.01; now += 0.025)
    q.tick(
      now,
      (_, t) => notes.push(t),
      (t) => clicks.push(t),
      () => shortPlan(1),
    );
  expect(notes).toEqual([0, 2, 3, 4]);
  expect(clicks).toEqual(notes);
  expect(q.position(4.001).cycle).toBe(3);
});
it("preserves explicit tab while filling another measure and clips leading holds", () => {
  const s = newSong();
  s.tempo = 120;
  const m = s.measures[0];
  m.chords = [];
  m.tab = { slots: Array.from({ length: 8 }, emptySlot) };
  m.tab.slots[6][5] = 3;
  m.tab.slots[7][5] = "hold";
  const next = newMeasure(1);
  next.chords = [];
  next.tab = { slots: Array.from({ length: 8 }, emptySlot) };
  next.tab.slots[0][5] = "hold";
  next.tab.slots[1][5] = "hold";
  const last = newMeasure(2);
  last.chords = [{ id: "g", beat: 0, chordName: "G" }];
  s.measures = [m, next, last];
  const compiled = compilePlayback(s);
  expect(compiled.events[0].time).toBe(1.5);
  expect(compiled.events[0].midi).toBe(43);
  const plan = practiceTimeline(s, 1, 1, 1);
  expect(plan.events).toEqual([
    expect.objectContaining({ time: 0, duration: 0.5, midi: 43 }),
  ]);
});
it("scores beat offsets across meter and tempo changes", () => {
  const s = newSong();
  s.tempo = 120;
  s.timeSignature = [3, 8];
  s.measures[0].chords = [];
  s.measures[0].tab = { slots: Array.from({ length: 6 }, emptySlot) };
  const next = newMeasure(1, 2);
  next.timeSignature = [2, 4];
  next.tempoOverride = 90;
  next.chords = [];
  s.measures.push(next);
  const plan = practiceTimeline(s, 1);
  expect(plan.clicks.map((c) => c.time)).toEqual([
    0,
    0.25,
    0.5,
    0.75,
    0.75 + 2 / 3,
  ]);
  expect(plan.duration).toBeCloseTo(0.75 + 4 / 3);
  const q = new TimelineQueue(plan, 2, false);
  expect(q.nearestBeatOffset(2 + 0.75 + 0.02)).toBeCloseTo(20);
  expect(q.nearestBeatOffset(2 + 0.75 + 2 / 3 - 0.03)).toBeCloseTo(-30);
});
