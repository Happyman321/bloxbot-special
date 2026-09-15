// Audio arrives only through the parent process's stdin. No server or cloud connection.
const path = require("node:path");
const readline = require("node:readline");
const { OnlineRecognizer } = require("./node_modules/sherpa-onnx-node");

const model = (name) => path.join(__dirname, "model", name);
const recognizer = new OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 128 },
  modelConfig: {
    transducer: { encoder: model("encoder.onnx"), decoder: model("decoder.onnx"), joiner: model("joiner.onnx") },
    tokens: model("tokens.txt"), numThreads: 2, provider: "cpu", debug: 0,
  },
  decodingMethod: "greedy_search",
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 1.2,
  rule3MinUtteranceLength: 20,
});
let stream;
let session;
const reply = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const decode = () => {
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
};
reply({ ready: true });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    const request = JSON.parse(line);
    if (request.op === "start") {
      stream = recognizer.createStream();
      session = request.session;
      reply({ partial: "", finalText: "" });
      return;
    }
    if (request.op === "cancel") {
      if (session === request.session) {
        stream = undefined;
        session = undefined;
      }
      reply({ partial: "", finalText: "" });
      return;
    }
    if (!stream || session !== request.session) throw new Error("Voice session is no longer active.");
    if (request.op === "audio") {
      if (!Array.isArray(request.samples) || request.samples.length > 48000 ||
          !request.samples.every(Number.isFinite) || request.sampleRate < 8000 || request.sampleRate > 96000) {
        throw new Error("Invalid microphone audio.");
      }
      stream.acceptWaveform({ sampleRate: request.sampleRate, samples: Float32Array.from(request.samples) });
      const text = decode();
      if (recognizer.isEndpoint(stream)) {
        recognizer.reset(stream);
        reply({ partial: "", finalText: text });
      } else {
        reply({ partial: text, finalText: "" });
      }
      return;
    }
    if (request.op === "finish") {
      stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) });
      stream.inputFinished();
      const text = decode();
      stream = undefined;
      session = undefined;
      reply({ partial: "", finalText: text });
      return;
    }
    throw new Error("Unknown voice operation.");
  } catch (error) {
    reply({ error: error.message });
  }
}).on("close", () => process.exit(0));
