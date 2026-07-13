import { describe, expect, it } from "vitest";

import { chatErrorMessage, isChatAbortError } from "@/lib/chatErrors";

describe("chatErrorMessage", () => {
  it("extracts OpenCode provider error reasons", () => {
    expect(
      chatErrorMessage({ name: "UnknownError", data: { message: "Token refresh failed: 401" } }),
    ).toBe("Token refresh failed: 401");
  });

  it("extracts nested SDK response errors", () => {
    expect(chatErrorMessage({ body: { error: { message: "Model is unavailable" } } })).toBe(
      "Model is unavailable",
    );
  });

  it("provides a useful output-limit explanation", () => {
    expect(chatErrorMessage({ name: "MessageOutputLengthError", data: {} })).toBe(
      "The model stopped because it reached its output limit.",
    );
  });

  it("falls back when OpenCode supplies no reason", () => {
    expect(chatErrorMessage(undefined)).toBe(
      "The model request failed without an explanation.",
    );
  });

  it("recognizes user-initiated aborts", () => {
    expect(isChatAbortError({ name: "MessageAbortedError", data: { message: "Aborted" } })).toBe(
      true,
    );
    expect(isChatAbortError({ name: "UnknownError", data: { message: "Failed" } })).toBe(false);
  });
});
