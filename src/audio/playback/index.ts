import { audioNotePlan } from "../intelligence/notePractice";
import * as Tone from "tone";
import { z } from "zod";
import { type Song, resolveTuning, SongV1 } from "../../schema/song.v1";
import { frequencyOf } from "../../theory/pitch";
import { chordToTab } from "../../transforms";
import { enableAudio } from "../context";
export const NoteEventSchema = z.object({
  time: z.number(),
  duration: z.number(),
  midi: z.number(),
  string: z.number().int(),
  measure: z.number().int(),
  slot: z.number().int(),
  muted: z.boolean(),
});
export type NoteEvent = z.infer<typeof NoteEventSchema>;
export function compilePlayback(input: Song, multiplier = 1) {
  SongV1.parse(input);
  const song = structuredClone(input);
  for (let i = 0; i < song.measures.length; i++) {
    const m = song.measures[i];
    // Audio chord labels carry no strumming or fingering information.
    if (!m.tab && m.chords.length && song.provenance?.source !== "audio") {
      const single = { ...song, measures: [{ ...m, index: 0 }] };
      song.measures[i] = {
        ...chordToTab(single).song.measures[0],
        index: m.index,
      };
    }
  }
  const tuning = resolveTuning(song.tuningId),
    events: NoteEvent[] = [];
  const active: (NoteEvent | null)[] = Array(6).fill(null);
  const measures: {
    time: number;
    duration: number;
    beatDuration: number;
    slots: number;
  }[] = [];
  let time = 0;
  for (const [mi, m] of song.measures.entries()) {
    const [beats, denom] = m.timeSignature ?? song.timeSignature;
    const beatDuration =
        ((60 / (m.tempoOverride ?? song.tempo) / multiplier) * 4) / denom,
      slotDuration = beatDuration / m.subdivision;
    measures.push({
      time,
      duration: beats * beatDuration,
      beatDuration,
      slots: beats * m.subdivision,
    });
    for (let si = 0; si < beats * m.subdivision; si++) {
      for (let st = 0; st < 6; st++) {
        const cell = m.tab?.slots[si]?.[st] ?? null;
        if (cell === "hold" && active[st]) {
          active[st]!.duration += slotDuration;
        } else if (typeof cell === "number" || cell === "x") {
          const e = {
            time: time + si * slotDuration,
            duration: cell === "x" ? 0.035 : slotDuration,
            midi:
              tuning.midi[st] +
              song.capo +
              (typeof cell === "number" ? cell : 0),
            string: st,
            measure: mi,
            slot: si,
            muted: cell === "x",
          };
          events.push(e);
          active[st] = cell === "x" ? null : e;
        } else active[st] = null;
      }
    }
    time += beats * beatDuration;
  }
  const plan = audioNotePlan(song,multiplier,0,song.measures.length-1);
  if (plan) {
    const review = song.provenance!.audioReview!, r = review.reviewed;
    const exactMeasures = measures.map((m,i) => {
      const start = i === 0 ? 0 : r.beats[r.firstDownbeatIndex+i*r.meter];
      const end = Math.min(review.duration,r.beats[r.firstDownbeatIndex+(i+1)*r.meter] ?? review.duration);
      return { ...m, time:start/multiplier, duration:(end-start)/multiplier };
    });
    return { events: plan.targets.filter(t=>t.supported).map(t=>({time:t.time,duration:t.duration,
      midi:t.notes[0].midi,string:t.notes[0].string,measure:t.measure,slot:t.slot,muted:false})),
      measures:exactMeasures, duration:plan.duration };
  }
  return { events, measures, duration: time };
}
export class GuitarPlayer {
  private synths: Tone.Synth[] = [];
  private noise: Tone.NoiseSynth | undefined;
  async enable() {
    await enableAudio();
    if (!this.synths.length) {
      this.synths = Array.from({ length: 6 }, () =>
        new Tone.Synth({
          oscillator: { type: "triangle" },
          envelope: { attack: 0.004, decay: 0.2, sustain: 0.12, release: 0.15 },
          volume: -16,
        }).toDestination(),
      );
      this.noise = new Tone.NoiseSynth({
        noise: { type: "pink" },
        envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.02 },
        volume: -30,
      }).toDestination();
    }
  }
  play(event: NoteEvent, at: number, a4 = 440) {
    if (event.muted) this.noise?.triggerAttackRelease(0.025, at);
    else
      this.synths[event.string]?.triggerAttackRelease(
        frequencyOf(event.midi, a4),
        Math.max(0.015, event.duration),
        at,
      );
  }
  stop() {
    this.synths.forEach((s) => s.triggerRelease());
  }
  dispose() {
    this.synths.forEach((s) => s.dispose());
    this.noise?.dispose();
    this.synths = [];
  }
}
export function clickAt(
  ctx: AudioContext,
  time: number,
  accent: boolean,
  sound: "click" | "wood" | "beep",
) {
  const osc = ctx.createOscillator(),
    gain = ctx.createGain();
  osc.type =
    sound === "wood" ? "triangle" : sound === "beep" ? "sine" : "square";
  osc.frequency.value = (accent ? 1200 : 800) * (sound === "wood" ? 0.6 : 1);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.075, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.05);
}
