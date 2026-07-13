type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isChatAbortError(error: unknown): boolean {
  const root = asRecord(error);
  const nestedError = asRecord(root?.error);
  return root?.name === "MessageAbortedError" || nestedError?.name === "MessageAbortedError";
}

/** Extract the most useful user-facing reason from SDK, SSE, and transport errors. */
export function chatErrorMessage(error: unknown): string {
  const direct = nonEmptyString(error);
  if (direct) return direct;

  if (error instanceof Error) {
    return error.message.trim() || error.name || "The model request failed.";
  }

  const root = asRecord(error);
  if (!root) return "The model request failed without an explanation.";

  const data = asRecord(root.data);
  const nestedError = asRecord(root.error);
  const nestedData = asRecord(nestedError?.data);
  const body = asRecord(root.body);
  const bodyError = asRecord(body?.error);

  const reason = [
    data?.message,
    nestedData?.message,
    bodyError?.message,
    body?.message,
    root.message,
  ]
    .map(nonEmptyString)
    .find((value): value is string => value !== null);
  if (reason) return reason;

  const name = nonEmptyString(root.name) ?? nonEmptyString(nestedError?.name);
  if (name === "MessageOutputLengthError") {
    return "The model stopped because it reached its output limit.";
  }
  if (name === "MessageAbortedError") return "The response was stopped.";
  if (name) return `The model request failed (${name}).`;

  return "The model request failed without an explanation.";
}
