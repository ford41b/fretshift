import { parseChordPro } from "../io/chordpro";
import { chordToTab } from "../transforms";
export const sampleCharts = [
  `{title: Amazing Grace}\n{artist: Traditional · public domain}\n{key: G}\n{tempo: 84}\n{time: 3/4}\n{start_of_verse: Verse 1}\n[G]Amazing grace, how [C]sweet the [G]sound\n[G]That saved a wretch like [D]me\n[G]I once was lost, but [C]now am [G]found\n[Em]Was blind, but [D]now I [G]see\n{start_of_verse: Verse 2}\n[G]'Twas grace that taught my [C]heart to [G]fear\n[G]And grace my fears re[D]lieved\n[G]How precious did that [C]grace ap[G]pear\n[Em]The hour I [D]first be[G]lieved`,
  `{title: House of the Rising Sun}\n{artist: Traditional · public domain}\n{key: Am}\n{tempo: 92}\n{time: 6/8}\n{start_of_intro}\n[Am] [C] [D] [F]\n[Am] [E] [Am] [E]\n{start_of_verse}\n[Am]There is a [C]house in [D]New Or[F]leans\n[Am]They call the [C]Rising [E]Sun\n[Am]And it's been the [C]ruin of [D]many a poor [F]boy\n[Am]And God, I [E]know, I'm [Am]one`,
  `{title: Scarborough Fair}\n{artist: Traditional · public domain}\n{key: Dm}\n{tempo: 76}\n{time: 3/4}\n{tuning: dadgad}\n{start_of_verse}\n[Dm]Are you going to [C]Scarborough [Dm]Fair\n[F]Parsley, [Dm]sage, rose[G]mary and [Am]thyme\n[Dm]Remember [F]me to [C]one who lives [Dm]there\n[Dm]She once [C]was a true love of [Dm]mine`,
  `{title: Wayfaring Stranger}\n{artist: Traditional · public domain}\n{key: Am}\n{capo: 2}\n{tempo: 80}\n{start_of_verse}\n[Am]I am a poor wayfaring stranger\n[Dm]While traveling [E7]through this world be[Am]low\n[Am]There is no sickness, toil nor danger\n[Dm]In that bright [E7]world to which I [Am]go\n{start_of_chorus}\n[F]I'm going there to see my [C]father\n[Dm]I'm going there no more to [E7]roam\n[Am]I'm only going over Jordan\n[Dm]I'm only [E7]going over [Am]home`,
  `{title: Greensleeves}\n{artist: Traditional · public domain}\n{key: Am}\n{tempo: 104}\n{time: 3/4}\n{start_of_verse}\n[Am]Alas, my [C]love, you [G]do me [Em]wrong\n[Am]To cast me [F]off dis[E]courteously\n[Am]For I have [C]loved you [G]well and [Em]long\n[Am]Delighting [E]in your [Am]company\n{start_of_chorus}\n[C]Greensleeves was [G]all my [Em]joy\n[Am]Greensleeves was [F]my de[E]light`,
];
export function createSamples() {
  return sampleCharts.map((text, i) => {
    let s = chordToTab(parseChordPro(text)).song;
    s.id = `sample-${i + 1}`;
    s.tags = [
      "Public domain",
      i === 2 ? "Alternate tuning" : i === 0 ? "Easy" : "Folk",
    ];
    if (i === 1)
      s = {
        ...s,
        measures: s.measures.map((m) => ({
          ...m,
          tab: m.tab
            ? {
                slots: m.tab.slots.map((slot, si) => {
                  const c = [...m.chords]
                    .reverse()
                    .find((c) => c.beat * m.subdivision <= si);
                  return slot.map((_cell, st) =>
                    st === 5 - (si % 6)
                      ? (c?.voicing?.frets[st] ?? null)
                      : null,
                  ) as typeof slot;
                }),
              }
            : undefined,
        })),
      };
    return s;
  });
}
