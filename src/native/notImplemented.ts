export class NotImplementedError extends Error {
  constructor(name: string) {
    super(`${name} is not implemented yet — native module pending`)
    this.name = 'NotImplementedError'
  }
}

export function notImplemented(name: string): never {
  throw new NotImplementedError(name)
}
