import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import pb from "@/api/pocketbase";
import { useAuth } from "@/contexts/AuthContext";

interface StaffQueueContextValue {
  revision: number;
  historyUnread: boolean;
  markHistoryRead: () => void;
}

const StaffQueueContext = createContext<StaffQueueContextValue | undefined>(undefined);

function readUnread(key: string) {
  try { return Boolean(key) && window.localStorage.getItem(key) === "true"; }
  catch { return false; }
}

export function StaffQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const storeId = user?.store;
  const canUse = Boolean(userId && storeId && (user?.role === "admin" || user?.role === "staff"));
  const storageKey = canUse ? `staff-queue-history:${storeId}:${userId}` : "";
  const [historyState, setHistoryState] = useState({ key: "", unread: false });
  const [revision, setRevision] = useState(0);
  const historyUnread = canUse && (historyState.key === storageKey ? historyState.unread : readUnread(storageKey));

  const setUnread = useCallback((unread: boolean) => {
    if (!storageKey) return;
    setHistoryState({ key: storageKey, unread });
    try { window.localStorage.setItem(storageKey, String(unread)); }
    catch { /* Keep the indicator working when browser storage is unavailable. */ }
  }, [storageKey]);

  useEffect(() => {
    if (!canUse) return;
    let active = true;
    const subscription = pb.collection("staff_queue_signals").subscribe("*", ({ action, record }) => {
      if (!active || record.store !== storeId) return;
      setRevision((current) => current + 1);
      if (action !== "delete" && record.event_type === "history" && record.actor_id && record.actor_id !== userId) setUnread(true);
    });
    void subscription.catch((error) => {
      if (active) console.warn("Không thể kết nối cập nhật hàng chờ realtime:", error);
    });
    return () => {
      active = false;
      void subscription.then((unsubscribe) => unsubscribe()).catch(() => {});
    };
  }, [canUse, storeId, userId, setUnread]);

  return <StaffQueueContext.Provider value={{ revision, historyUnread, markHistoryRead: () => setUnread(false) }}>
    {children}
  </StaffQueueContext.Provider>;
}

export function useStaffQueue() {
  const context = useContext(StaffQueueContext);
  if (!context) throw new Error("useStaffQueue must be used within StaffQueueProvider");
  return context;
}
