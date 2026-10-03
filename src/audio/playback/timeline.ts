import { audioNotePlan } from "../intelligence/notePractice";
import { hasMediaTimeline, type Song } from "../../schema/song.v1";
import { compilePlayback, type NoteEvent } from "./index";
export function practiceTimeline(
  song: Song,
  multiplier: number,
  startMeasure = 0,
  endMeasure = song.measures.length - 1,
) {
  const notePlan = audioNotePlan(song,multiplier,startMeasure,endMeasure);
  if (notePlan) {
    const r = song.provenance!.audioReview!.reviewed;
    const positions = r.beats.flatMap((at,i) => Array.from({length:4},(_,slot)=>{
      const end = r.beats[i+1] ?? song.provenance!.audioReview!.duration;
      return {time:(at+slot*(end-at)/4-notePlan.begin)/multiplier,
        measure:Math.max(0,Math.floor((i-r.firstDownbeatIndex)/r.meter)),
        slot:((i-r.firstDownbeatIndex)%r.meter+r.meter)%r.meter*4+slot};
    })).filter(p=>p.measure>=startMeasure && p.measure<=endMeasure && p.time>=0 && p.time<notePlan.duration);
    const clicks = positions.filter(p=>p.slot%4===0).map(p=>({...p,accent:p.slot===0}));
    return { events:notePlan.targets.filter(t=>t.supported).map(t=>({time:t.time,duration:t.duration,
      midi:t.notes[0].midi,string:t.notes[0].string,measure:t.measure,slot:t.slot,muted:false})),
      clicks, positions, duration:notePlan.duration, begin:notePlan.begin,sourceQuarterOffset:startMeasure*r.meter };
  }
  const compiled = compilePlayback(song, multiplier),
    begin = compiled.measures[startMeasure]?.time ?? 0,
    last = compiled.measures[endMeasure];
  if (!last) throw new Error("Select a valid practice region.");
  const end = last.time + last.duration,
    duration = end - begin;
  const events = compiled.events
    .filter((e) => e.time < end && e.time + e.duration > begin)
    .map((e) => ({
      ...e,
      time: Math.max(0, e.time - begin),
      duration: Math.min(end, e.time + e.duration) - Math.max(begin, e.time),
      measure: Math.max(startMeasure, e.measure),
    }));
  const clicks: {
    time: number;
    accent: boolean;
    measure: number;
    slot: number;
  }[] = [];
  const positions: { time: number; measure: number; slot: number }[] = [];
  for (let mi = startMeasure; mi <= endMeasure; mi++) {
    const m = compiled.measures[mi];
    for (let slot = 0; slot < m.slots; slot++) {
      const time = m.time - begin + (slot * m.duration) / m.slots;
      positions.push({ time, measure: mi, slot });
      if (slot % song.measures[mi].subdivision === 0)
        clicks.push({ time, accent: slot === 0, measure: mi, slot });
    }
  }
  const sourceQuarterOffset = song.measures
    .slice(0, startMeasure)
    .reduce((sum, m) => {
      const [n, d] = m.timeSignature ?? song.timeSignature;
      return sum + (n * 4) / d;
    }, 0);
  const reviewed = hasMediaTimeline(song.provenance?.source) ? song.provenance?.audioReview?.reviewed : undefined;
  if (reviewed?.timingConfirmed && song.measures.slice(startMeasure, endMeasure + 1)
    .every((measure) => measure.timingConfirmed === true && !measure.tab)) {
    const firstBeat = reviewed.firstDownbeatIndex + startMeasure * reviewed.meter;
    const sourceStart = reviewed.beats[firstBeat];
    if (sourceStart !== undefined) {
      const exactDuration = Math.max(0, Math.min(song.provenance!.audioReview!.duration,
        reviewed.beats[reviewed.firstDownbeatIndex + (endMeasure + 1) * reviewed.meter] ??
          song.provenance!.audioReview!.duration) - sourceStart) / multiplier;
      const exactClicks: typeof clicks = [], exactPositions: typeof positions = [];
      for (let mi = startMeasure; mi <= endMeasure; mi++) {
        const subdivision = song.measures[mi].subdivision;
        for (let b = 0; b < reviewed.meter; b++) {
          const index = reviewed.firstDownbeatIndex + mi * reviewed.meter + b;
          const at = reviewed.beats[index];
          if (at === undefined || at >= sourceStart + exactDuration * multiplier) continue;
          const beatDuration = (reviewed.beats[index + 1] ?? at + 60 / reviewed.tempoBpm) - at;
          for (let slot = 0; slot < subdivision; slot++) {
            const relative = (at + slot * beatDuration / subdivision - sourceStart) / multiplier;
            if (relative < exactDuration)
              exactPositions.push({ time: relative, measure: mi, slot: b * subdivision + slot });
          }
          exactClicks.push({ time: (at - sourceStart) / multiplier, accent: b === 0,
            measure: mi, slot: b * subdivision });
        }
      }
      return { events: [], clicks: exactClicks, positions: exactPositions,
        duration: exactDuration, begin: sourceStart, sourceQuarterOffset };
    }
  }
  return { events, clicks, positions, duration, begin, sourceQuarterOffset };
}
export type PracticeTimeline = ReturnType<typeof practiceTimeline>;
export class TimelineQueue {
  private eventIndex = 0;
  private clickIndex = 0;
  private cycle = 0;
  private cycleStart: number;
  private plans: { start: number; timeline: PracticeTimeline; cycle: number }[];
  constructor(
    public timeline: PracticeTimeline,
    public start: number,
    public loop: boolean,
  ) {
    this.cycleStart = start;
    this.plans = [{ start, timeline, cycle: 0 }];
  }
  tick(
    now: number,
    note: (event: NoteEvent, time: number) => void,
    click: (time: number, accent: boolean) => void,
    onCycle?: (cycle: number, time: number) => PracticeTimeline | void,
  ) {
    const horizon = now + 0.1;
    let safety = 0;
    while (++safety < 100) {
      const base = this.cycleStart;
      while (
        this.eventIndex < this.timeline.events.length &&
        base + this.timeline.events[this.eventIndex].time < horizon
      ) {
        const e = this.timeline.events[this.eventIndex++];
        note(e, base + e.time);
      }
      while (
        this.clickIndex < this.timeline.clicks.length &&
        base + this.timeline.clicks[this.clickIndex].time < horizon
      ) {
        const e = this.timeline.clicks[this.clickIndex++];
        click(base + e.time, e.accent);
      }
      if (this.loop && base + this.timeline.duration < horizon) {
        this.cycle++;
        this.eventIndex = 0;
        this.clickIndex = 0;
        this.cycleStart = base + this.timeline.duration;
        const next = onCycle?.(this.cycle, this.cycleStart);
        if (next) this.timeline = next;
        this.plans.push({
          start: this.cycleStart,
          timeline: this.timeline,
          cycle: this.cycle,
        });
        this.plans = this.plans.filter(
          (p, i, list) => i === list.length - 1 || list[i + 1].start > now,
        );
        continue;
      }
      break;
    }
  }
  private plan(now: number) {
    return (
      [...this.plans].reverse().find((p) => p.start <= now) ?? this.plans[0]
    );
  }
  position(now: number) {
    const p = this.plan(now),
      time = Math.max(0, Math.min(now - p.start, p.timeline.duration));
    const current =
      [...p.timeline.positions].reverse().find((p) => p.time <= time) ??
      p.timeline.positions[0];
    return { ...current, cycle: p.cycle, relativeTime: time };
  }
  activePitches(now: number) {
    const p = this.plan(now),
      time = Math.max(0, now - p.start);
    return p.timeline.events
      .filter((e) => !e.muted && e.time <= time && e.time + e.duration > time)
      .map((e) => e.midi);
  }
  nearestBeatOffset(now: number) {
    if (now < this.start) return null;
    const p = this.plan(now),
      relative = now - p.start;
    const beats = [
      ...p.timeline.clicks.map((c) => c.time),
      p.timeline.duration,
    ];
    const nearest = beats.reduce((a, b) =>
      Math.abs(a - relative) <= Math.abs(b - relative) ? a : b,
    );
    return (relative - nearest) * 1000;
  }
}
