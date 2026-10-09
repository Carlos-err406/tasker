import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Talks to the running Tasker service the same way the popover does. */
export class ServiceClient {
  private connection?: Promise<{ origin: string; cookie: string }>;

  constructor(private directory: string) {}

  async rpc<T>(channel: string, ...args: unknown[]): Promise<T> {
    const response = await this.request("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, args }),
    });
    const [error, data] = (await response.json()) as [
      { message: string } | null,
      T,
    ];
    if (error) throw new Error(error.message);
    return data;
  }

  async image(id: string): Promise<{ data: Buffer; mimeType: string }> {
    const response = await this.request(
      `/attachments/${encodeURIComponent(id)}`,
    );
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") ?? "",
    };
  }

  private async request(path: string, init: RequestInit = {}) {
    for (let attempt = 0; ; attempt++) {
      const { origin, cookie } = await (this.connection ??= this.connect());
      let response: Response;
      try {
        response = await fetch(origin + path, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            origin,
            cookie,
            "x-tasker-request": "1",
            "x-tasker-client": "agent",
          },
        });
      } catch {
        // The service restarts with a new address and token; reconnect once.
        this.connection = undefined;
        if (attempt) throw new Error(notRunning);
        continue;
      }
      if (response.status === 403 && !attempt) {
        this.connection = undefined;
        continue;
      }
      if (!response.ok)
        throw new Error(
          (await response.text()) || `Tasker service error ${response.status}`,
        );
      return response;
    }
  }

  private async connect() {
    let runtime: { origin: string; token: string };
    try {
      runtime = JSON.parse(
        await readFile(join(this.directory, "runtime.json"), "utf8"),
      );
    } catch {
      this.connection = undefined;
      throw new Error(notRunning);
    }
    const response = await fetch(runtime.origin + "/session", {
      method: "POST",
      headers: { origin: runtime.origin, "x-tasker-bootstrap": runtime.token },
    }).catch(() => undefined);
    const cookie = response?.headers.get("set-cookie")?.split(";")[0];
    if (!response || response.status !== 204 || !cookie) {
      this.connection = undefined;
      throw new Error(notRunning);
    }
    return { origin: runtime.origin, cookie };
  }
}

const notRunning =
  "Tasker isn't running. Start it from SwiftBar (or re-run the installer) and try again.";
