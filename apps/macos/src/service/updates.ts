import { readFileSync } from "node:fs";
const REPO = "https://github.com/Carlos-err406/tasker";
export const installedVersion: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;
function parts(version: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Invalid release version");
  const values = version.split(".").map(Number);
  if (!values.every(Number.isSafeInteger))
    throw new Error("Invalid release version");
  return values;
}
export function newer(candidate: string, current: string) {
  const a = parts(candidate),
    b = parts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function macRelease(value: any, current: string) {
  if (
    !value ||
    value.draft ||
    value.prerelease ||
    typeof value.tag_name !== "string" ||
    !value.tag_name.startsWith("v")
  )
    throw new Error("Invalid Tasker release");
  const version = value.tag_name.slice(1);
  parts(version);
  const archive = `tasker-swiftbar-${version}-macos.tar.gz`;
  if (
    !Array.isArray(value.assets) ||
    ![archive, archive + ".sha256"].every((name) =>
      value.assets.some(
        (asset: any) =>
          asset.name === name && asset.state === "uploaded" && asset.size > 0,
      ),
    )
  )
    throw new Error("The latest release has no complete Mac update");
  return newer(version, current) ? version : null;
}
export class MacUpdates {
  private active?: Promise<void>;
  private version: string | null = null;
  private phase = "idle";
  private error: string | null = null;
  constructor(
    private request: typeof fetch = fetch,
    private current = installedVersion,
  ) {}
  status() {
    return {
      currentVersion: this.current,
      version: this.version,
      phase: this.phase,
      busy: !!this.active,
      progress: 0,
      error: this.error,
    };
  }
  async check() {
    if (!this.active) {
      this.phase = "checking";
      this.error = null;
      this.active = Promise.resolve().then(async () => {
        try {
          const response = await this.request(
            "https://api.github.com/repos/Carlos-err406/tasker/releases/latest",
            {
              headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "Tasker-Mac",
              },
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            },
          );
          if (response.status === 404) {
            this.version = null;
            this.phase = "unpublished";
            return;
          }
          if (!response.ok)
            throw new Error(
              response.status === 403 || response.status === 429
                ? "GitHub is limiting update checks. Try again later."
                : "Could not check for updates. Try again.",
            );
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Empty update response");
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 2 * 1024 * 1024)
                throw new Error("Update response is too large");
              chunks.push(value);
            }
          } catch (error) {
            await reader.cancel();
            throw error;
          }
          this.version = macRelease(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
            this.current,
          );
          this.phase = this.version ? "available" : "current";
        } catch (error) {
          this.error =
            error instanceof Error
              ? error.message
              : "Could not check for updates";
          this.phase = "error";
        } finally {
          this.active = undefined;
        }
      });
    }
    await this.active;
    return this.status();
  }
  releaseUrl() {
    if (!this.version) throw new Error("Check for an available update first");
    return `${REPO}/releases/tag/v${this.version}`;
  }
}
