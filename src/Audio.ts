// All sounds are synthesized locally. No external media or network is required.
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motor: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  muted = false;
  unlock() {
    if (!this.ctx) {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (!C) return;
      this.ctx = new C();
      this.master = this.ctx!.createGain();
      this.master.connect(this.ctx!.destination);
      this.motor = this.ctx!.createOscillator();
      this.motor.type = "sawtooth";
      this.motorGain = this.ctx!.createGain();
      const filter = this.ctx!.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 340;
      this.motor.connect(filter);
      filter.connect(this.motorGain);
      this.motorGain.connect(this.master);
      this.motorGain.gain.value = 0;
      this.motor.start();
    }
    this.ctx!.resume().catch(() => {});
    this.master!.gain.value = this.muted ? 0 : 0.38;
  }
  tick(speed: number, boost: boolean, active: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(this.muted ? 0 : 0.38, t, 0.03);
    this.motor!.frequency.setTargetAtTime(
      40 + speed * 0.22 + (boost ? 18 : 0),
      t,
      0.06,
    );
    this.motorGain!.gain.setTargetAtTime(
      active ? 0.035 + speed * 0.00012 : 0,
      t,
      0.05,
    );
  }
  beep(
    freq = 660,
    duration = 0.1,
    volume = 0.16,
    type: OscillatorType = "sine",
  ) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + duration);
  }
  finish(won: boolean) {
    [0, 1, 2, 3].forEach((i) =>
      setTimeout(
        () =>
          this.beep(
            (won ? [523, 659, 784, 1047] : [330, 277, 220, 165])[i],
            0.3,
            0.15,
          ),
        i * 130,
      ),
    );
  }
}
