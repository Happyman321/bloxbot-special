import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalVoiceCapture, voiceErrorMessage } from "@/lib/localVoice";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let track: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let media: MediaStream;
let worklet: WorkletMock;
let context: ContextMock;
class ContextMock {
  sampleRate = 16000;
  state = "running";
  destination = {};
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  constructor() {
    context = this;
  }
}
class WorkletMock {
  port = {
    onmessage: null as
      | null
      | ((event: { data: { samples?: Float32Array; flushed?: boolean } }) => void),
    postMessage: vi.fn(() => {
      // Simulate the last partially-filled audio block when stop is clicked.
      this.port.onmessage?.({ data: { samples: new Float32Array([0.25]) } });
      this.port.onmessage?.({ data: { flushed: true } });
    }),
  };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    worklet = this;
  }
}
function callbacks() {
  return { status: vi.fn(), update: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  track = { stop: vi.fn(), onended: null };
  media = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  vi.stubGlobal("AudioContext", ContextMock);
  vi.stubGlobal("AudioWorkletNode", WorkletMock);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(media) } });
  vi.mocked(invoke).mockImplementation(async (command) => ({
    partial: command === "voice_audio" ? "hello" : "",
    finalText: command === "voice_finish" ? "Hello world." : "",
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("local microphone lifecycle", () => {
  it("streams audio, flushes the tail before finish, and releases the microphone", async () => {
    const cb = callbacks();
    const voice = new LocalVoiceCapture(cb);
    await voice.start();
    worklet.port.onmessage?.({ data: { samples: new Float32Array([0.1, 0.2]) } });
    await tick();
    expect(cb.update).toHaveBeenCalledWith({ partial: "hello", finalText: "" });
    expect(await voice.stop()).toBe(true);
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands).toEqual(["voice_start", "voice_audio", "voice_audio", "voice_finish"]);
    expect(cb.update).toHaveBeenLastCalledWith({ partial: "", finalText: "Hello world." });
    expect(track.stop).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(cb.status).toHaveBeenLastCalledWith("idle");
  });

  it("does not insert a late transcript after cancellation or a chat switch", async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "voice_audio"
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : { partial: "", finalText: "" },
    );
    const cb = callbacks();
    const voice = new LocalVoiceCapture(cb);
    await voice.start();
    worklet.port.onmessage?.({ data: { samples: new Float32Array([0.1]) } });
    await tick();
    voice.cancel();
    complete({ partial: "", finalText: "Must not reach another chat" });
    await tick();
    expect(cb.update).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("voice_cancel", expect.any(Object));
  });

  it("releases a microphone granted after the user cancels startup", async () => {
    let grant!: (value: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    const cb = callbacks();
    const voice = new LocalVoiceCapture(cb);
    const starting = voice.start();
    voice.cancel();
    grant(media);
    await starting;
    expect(track.stop).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops capture on native failure and does not claim a successful finish", async () => {
    const cb = callbacks();
    const voice = new LocalVoiceCapture(cb);
    await voice.start();
    vi.mocked(invoke).mockRejectedValueOnce("Voice engine stopped");
    worklet.port.onmessage?.({ data: { samples: new Float32Array([0.1]) } });
    await tick();
    expect(cb.error).toHaveBeenCalledWith("Voice engine stopped");
    expect(track.stop).toHaveBeenCalled();
    expect(await voice.stop()).toBe(false);
  });

  it("reports denied permission without starting recognition", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const cb = callbacks();
    await new LocalVoiceCapture(cb).start();
    expect(cb.error).toHaveBeenCalledWith(expect.stringContaining("Allow microphone access"));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("explains a disconnected or missing microphone", () => {
    expect(voiceErrorMessage(new DOMException("", "NotFoundError"))).toContain("No microphone");
    expect(voiceErrorMessage(new DOMException("", "NotReadableError"))).toContain("unavailable");
  });
});
