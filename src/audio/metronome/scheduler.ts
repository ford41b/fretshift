export class LookaheadScheduler {
  nextTime = 0;
  index = 0;
  constructor(
    public interval: number,
    public lookahead = 0.1,
  ) {}
  start(time: number) {
    this.nextTime = time;
    this.index = 0;
  }
  tick(now: number, emit: (time: number, index: number) => void) {
    let safety = 0;
    while (this.nextTime < now + this.lookahead) {
      if (++safety > 1000)
        throw new Error(
          "Audio scheduler fell too far behind. Restart playback.",
        );
      emit(this.nextTime, this.index++);
      this.nextTime += this.interval;
    }
  }
}
