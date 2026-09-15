import { invoke } from "@tauri-apps/api/core";

export type VoiceStatus = "idle" | "starting" | "listening" | "finishing";
export interface VoiceUpdate {
  partial: string;
  finalText: string;
}
interface VoiceCallbacks {
  status: (status: VoiceStatus) => void;
  update: (update: VoiceUpdate) => void;
  error: (message: string) => void;
}

export function voiceErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "Allow microphone access for BloxBot, then try again.";
    if (error.name === "NotFoundError")
      return "No microphone found. Connect a microphone and try again.";
    if (error.name === "NotReadableError")
      return "The microphone is unavailable. Check whether another app is using it.";
  }
  return error instanceof Error ? error.message : String(error);
}

/** One capture session; the native recognizer stays warm between sessions. */
export class LocalVoiceCapture {
  private readonly session = crypto.randomUUID();
  private media?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private cancelled = false;
  private finishing = false;
  private started = false;
  private flushed?: () => void;

  constructor(private readonly callbacks: VoiceCallbacks) {}

  async start(): Promise<void> {
    this.callbacks.status("starting");
    try {
      this.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.cancelled) {
        this.release();
        return;
      }
      this.context = new AudioContext({ sampleRate: 16000 });
      await this.context.resume();
      await this.context.audioWorklet.addModule(
        new URL("/voice-capture.js", window.location.href).href,
      );
      if (this.cancelled) {
        this.release();
        return;
      }
      await invoke<VoiceUpdate>("voice_start", { session: this.session });
      this.started = true;
      if (this.cancelled) {
        this.cancelNative();
        this.release();
        return;
      }
      this.worklet = new AudioWorkletNode(this.context, "bloxbot-voice-capture");
      this.worklet.port.onmessage = ({
        data,
      }: MessageEvent<{ samples?: Float32Array; flushed?: boolean }>) => {
        if (data.samples) this.enqueue(data.samples);
        if (data.flushed) this.flushed?.();
      };
      this.source = this.context.createMediaStreamSource(this.media);
      this.source.connect(this.worklet);
      this.worklet.connect(this.context.destination);
      for (const track of this.media.getAudioTracks()) {
        track.onended = () => {
          if (!this.cancelled && !this.finishing)
            this.fail(new Error("Microphone disconnected. Reconnect it and try again."));
        };
      }
      this.callbacks.status("listening");
    } catch (error) {
      this.fail(error);
    }
  }

  private enqueue(samples: Float32Array): void {
    if (this.cancelled) return;
    if (++this.queued > 24) {
      this.fail(
        new Error("Voice processing cannot keep up. Close heavy background apps and try again."),
      );
      return;
    }
    const sampleRate = this.context!.sampleRate;
    this.queue = this.queue
      .then(async () => {
        if (this.cancelled) return;
        const update = await invoke<VoiceUpdate>("voice_audio", {
          session: this.session,
          samples: Array.from(samples),
          sampleRate,
        });
        if (!this.cancelled) this.callbacks.update(update);
      })
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.queued--;
      });
  }

  async stop(): Promise<boolean> {
    if (this.cancelled || this.finishing) return false;
    if (!this.worklet) {
      this.cancel();
      return false;
    }
    this.finishing = true;
    this.callbacks.status("finishing");
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        this.flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        this.worklet!.port.postMessage("flush");
      });
      this.release();
      await this.queue;
      if (this.cancelled) return false;
      const update = await invoke<VoiceUpdate>("voice_finish", { session: this.session });
      if (!this.cancelled) {
        this.callbacks.update(update);
        this.callbacks.status("idle");
      }
      this.cancelled = true;
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.release();
    this.cancelNative();
    this.callbacks.status("idle");
  }

  private cancelNative(): void {
    if (this.started) {
      void invoke("voice_cancel", { session: this.session }).catch((error: unknown) => {
        console.error("Voice cleanup failed:", error);
      });
    }
  }

  private fail(error: unknown): void {
    if (this.cancelled) return;
    this.cancel();
    this.callbacks.error(voiceErrorMessage(error));
  }

  private release(): void {
    this.flushed?.();
    if (this.worklet) this.worklet.port.onmessage = null;
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.media?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    if (this.context && this.context.state !== "closed") {
      void this.context
        .close()
        .catch((error: unknown) => console.error("Microphone cleanup failed:", error));
    }
  }
}
