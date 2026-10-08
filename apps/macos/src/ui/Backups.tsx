import { BackupsPanel } from "@tasker/ui";
import { manage } from "./host-adapter.js";
export function Backups(props: {
  onClose: () => void;
  onRestored: () => void;
}) {
  return <BackupsPanel {...props} manage={manage} manageSync={manage} />;
}
