import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePullToRefresh } from "../../../../packages/ui/src/hooks/use-pull-to-refresh";
import { PullToRefreshIndicator } from "../../../../packages/ui/src/components/PullToRefreshIndicator";
import "../../../../packages/ui/src/styles.css";
import "../../../android/src/mobile.css";

let finish: () => void = () => {};
Reflect.set(window, "finishRefresh", () => finish());

function Fixture() {
  const workspace = useRef<HTMLDivElement>(null);
  const [refreshes, setRefreshes] = useState(0);
  const pull = usePullToRefresh(
    workspace,
    () =>
      new Promise<void>((resolve) => {
        setRefreshes((value) => value + 1);
        finish = resolve;
      }),
  );
  return (
    <main className="mobile-shell">
      <output data-testid="refresh-count">{refreshes}</output>
      <div ref={workspace} className="mobile-workspace" data-testid="workspace">
        <PullToRefreshIndicator {...pull} />
        {Array.from({ length: 40 }, (_, i) => (
          <p key={i} style={{ height: 40 }}>
            Task {i}
          </p>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
