# Local voice input

BloxBot uses sherpa-onnx-node 1.13.8 (Apache-2.0) and the NVIDIA Nemotron Speech
Streaming English 0.6B model, converted to int8 ONNX with 160 ms chunks.
The model is distributed under the NVIDIA Open Model License (MODEL-LICENSE.html).
`pnpm build:voice` installs the model and native
runtime into the bundle; users need no separate download or API key.

- Engine: https://github.com/k2-fsa/sherpa-onnx
- Original model: https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b
- ONNX conversion: https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25
- Immutable model revision and SHA-256 checks are in `scripts/build-voice.mjs`.

The worker loads the model once and accepts audio through stdin only. It never
opens a network listener, sends audio to a service, or saves recordings.
Microphone capture starts only when the user clicks the microphone. English is
the supported dictation language for this model.
