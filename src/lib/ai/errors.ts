export class AiGenerationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "provider_error"
      | "timeout"
      | "invalid_json"
      | "schema_validation_failed"
  ) {
    super(message);
    this.name = "AiGenerationError";
  }
}
