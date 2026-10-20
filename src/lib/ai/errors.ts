export class AiGenerationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "provider_error"
      | "timeout"
      | "invalid_json"
      | "schema_validation_failed"
      | "circuit_open"
      | "disabled"
      | "refusal" // stop_reason "refusal": the provider declined
      | "truncated" // stop_reason "max_tokens": output cut off
  ) {
    super(message);
    this.name = "AiGenerationError";
  }
}
