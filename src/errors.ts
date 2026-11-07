/** Base class so callers can branch on a stable machine-readable code. */
export class DropPlannerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** Missing or malformed local configuration (API key, state file, port). */
export class ConfigError extends DropPlannerError {}

/** A drop brief submitted by a user failed validation. */
export class BriefValidationError extends DropPlannerError {
  constructor(readonly issues: string[]) {
    super('invalid_brief', `Invalid drop brief: ${issues.join('; ')}`)
  }
}

/** A plan submitted by the agent failed the application's merchandising guardrails. */
export class PlanValidationError extends DropPlannerError {
  constructor(readonly issues: string[]) {
    super('invalid_plan', `Plan failed guardrails: ${issues.join('; ')}`)
  }
}

/** A run could not be found or is not in a state that allows the requested action. */
export class RunStateError extends DropPlannerError {}

/** The ZooWork platform returned something the application cannot use. */
export class PlatformError extends DropPlannerError {}
