import { AboutPanel, type UpdateStatus } from "@tasker/ui";
import { getHost } from "@tasker/ui/host";
import { manage } from "./host-adapter.js";
const manageUpdates = (action: "status" | "check" | "install") =>
  manage<UpdateStatus>({ action: "updates-" + action });
export function About({ onClose }: { onClose: () => void }) {
  return (
    <AboutPanel
      platform="Mac"
      manage={manageUpdates}
      openExternal={(url) => getHost().openExternal(url)}
      onClose={onClose}
      backLabel="Back to help"
    />
  );
}
