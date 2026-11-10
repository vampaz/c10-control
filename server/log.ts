function timestamp(): string {
  return new Date().toISOString()
}

/** Timestamped log line, so container logs are greppable. */
export function log(message: string, detail?: unknown): void {
  if (detail === undefined) {
    console.log(`${timestamp()} ${message}`)
  } else {
    console.log(`${timestamp()} ${message}`, detail)
  }
}

/** Timestamped warning, used for recoverable failures. */
export function warn(message: string, detail?: unknown): void {
  if (detail === undefined) {
    console.warn(`${timestamp()} ${message}`)
  } else {
    console.warn(`${timestamp()} ${message}`, detail)
  }
}
