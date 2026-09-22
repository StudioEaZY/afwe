export class User {
  constructor(public readonly id: string, public readonly email: string, public readonly displayName: string) {}
}

export function isSameUser(a: User, b: User): boolean {
  return a.id === b.id;
}
