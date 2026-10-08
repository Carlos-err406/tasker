import { BackupsPanel } from "@tasker/ui";
import { manage } from "./host-adapter.js";
export function Backups(props: {
  onViewSync?: () => void;
  onClose: () => void;
  onRestored: () => void;
}) {
  return <BackupsPanel {...props} manage={manage} />;
}
