"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/lib/auth-store";

type Notice = {
  id: string;
  title: string;
  body: string;
};

export function RealtimeNotifications() {
  const [items, setItems] = useState<Notice[]>([]);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }

    const q = query(
      collection(db, "internal_notifications"),
      where("userId", "==", user.id),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs
        .map((d) => ({
          id: d.id,
          title: String(d.data().title ?? "Update"),
          body: String(d.data().body ?? ""),
          createdAt: String(d.data().createdAt ?? "")
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ id, title, body }) => ({
          id,
          title,
          body
        }));
      setItems(next);
    });
    return () => unsub();
  }, [user]);

  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <h3 className="mb-3 text-lg font-semibold">Realtime Notifications</h3>
      <div className="space-y-2">
        {items.map((i) => (
          <div key={i.id} className="rounded border border-slate-200 p-2">
            <p className="font-medium">{i.title}</p>
            <p className="text-sm text-slate-600">{i.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
