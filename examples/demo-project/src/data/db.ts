export class Db {
  constructor(public readonly role: "primary" | "replica") {}
  write(table: string, key: string, value: unknown) { return { table, key, value, role: this.role }; }
  read(table: string, key: string) { return { table, key, role: this.role }; }
}
export const primaryDb = new Db("primary");
