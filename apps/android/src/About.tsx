import { AboutPanel } from "@tasker/ui";
import { getHost } from "@tasker/ui/host";
import { manageUpdates } from "./updates";
export function About({ onClose }: { onClose: () => void }) {
  return (
    <AboutPanel
      platform="Android"
      manage={manageUpdates}
      openExternal={(url) => getHost().openExternal(url)}
      onClose={onClose}
      backLabel="Back to help"
    />
  );
}
