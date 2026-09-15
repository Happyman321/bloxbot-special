// Keep microphone work off the UI thread. Samples never leave this application.
class BloxbotVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        this.active = false;
        if (this.offset) this.port.postMessage({ samples: this.buffer.slice(0, this.offset) });
        this.offset = 0;
        this.port.postMessage({ flushed: true });
      }
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.active || !channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      this.buffer[this.offset++] = sample / channels.length;
      if (this.offset === this.buffer.length) {
        const samples = this.buffer;
        this.port.postMessage({ samples }, [samples.buffer]);
        this.buffer = new Float32Array(2048);
        this.offset = 0;
      }
    }
    // No output is written: microphone audio is never played through speakers.
    return true;
  }
}
registerProcessor("bloxbot-voice-capture", BloxbotVoiceCapture);
