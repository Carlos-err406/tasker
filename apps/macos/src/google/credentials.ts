import { execFileSync } from "node:child_process";
export interface Credentials {
  read(): string | null;
  write(token: string): void;
  remove(): void;
}
export function keychainCredentials(account: string): Credentials {
  const service = "org.tasker-swiftbar.google";
  const quote = (value: string) =>
    '"' +
    value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/[\r\n]/g, "") +
    '"';
  return {
    read() {
      try {
        return execFileSync(
          "/usr/bin/security",
          ["find-generic-password", "-s", service, "-a", account, "-w"],
          {
            encoding: "utf8",
            timeout: 10000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ).trim();
      } catch (error) {
        if ((error as { status?: number }).status === 44) return null;
        throw new Error("Could not read Google credentials from Keychain");
      }
    },
    write(token) {
      // Feed the secret through stdin instead of exposing it in process arguments.
      try {
        execFileSync("/usr/bin/security", ["-i"], {
          timeout: 10000,
          input: `add-generic-password -U -s ${quote(service)} -a ${quote(account)} -w ${quote(token)}\n`,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        throw new Error("Could not save Google credentials in Keychain");
      }
      if (this.read() !== token)
        throw new Error(
          "Could not verify saved Google credentials in Keychain",
        );
    },
    remove() {
      try {
        execFileSync(
          "/usr/bin/security",
          ["delete-generic-password", "-s", service, "-a", account],
          { stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
        );
      } catch (error) {
        if ((error as { status?: number }).status !== 44)
          throw new Error("Could not remove Google credentials from Keychain");
      }
    },
  };
}
