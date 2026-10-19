import { useEffect, useState } from "react";
import { browserApi, type SenderStatus } from "./browserApi";

/** Screen senders known to the control server, refreshed while mounted. */
export function useSenders(): SenderStatus[] {
  const [senders, setSenders] = useState<SenderStatus[]>([]);
  useEffect(() => {
    const poll = () => {
      void browserApi
        .getStatus()
        .then((status) => setSenders(status.senders))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);
  return senders;
}
