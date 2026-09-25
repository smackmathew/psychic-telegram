import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotificationsApi } from "../api/endpoints";
import type { NotificationSeverity } from "../types";
import { formatDate } from "../utils/format";

const SEVERITY_CLASSES: Record<NotificationSeverity, string> = {
  info: "border-l-brand-500",
  warning: "border-l-amber-500",
  success: "border-l-emerald-500",
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data: notifications, isLoading } = useQuery({ queryKey: ["notifications", "all"], queryFn: () => NotificationsApi.list(false) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({ mutationFn: (id: string) => NotificationsApi.markRead(id), onSuccess: invalidate });
  const markAllRead = useMutation({ mutationFn: () => NotificationsApi.markAllRead(), onSuccess: invalidate });
  const runChecks = useMutation({ mutationFn: () => NotificationsApi.runChecks(), onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Notifications</h1>
        <div className="flex gap-2">
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => runChecks.mutate()}
            disabled={runChecks.isPending}
          >
            {runChecks.isPending ? "Checking..." : "Check now"}
          </button>
          <button
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={() => markAllRead.mutate()}
          >
            Mark all read
          </button>
        </div>
      </div>

      {isLoading && <p className="text-slate-500">Loading...</p>}

      <div className="space-y-2">
        {(notifications ?? []).map((n) => (
          <div
            key={n.id}
            className={`flex items-start justify-between gap-4 rounded-lg border-l-4 bg-white p-4 shadow-sm ${SEVERITY_CLASSES[n.severity]} ${
              n.is_read ? "opacity-60" : ""
            }`}
          >
            <div>
              <p className="text-sm font-semibold text-slate-800">{n.title}</p>
              <p className="text-sm text-slate-600">{n.message}</p>
              <p className="mt-1 text-xs text-slate-400">{formatDate(n.created_at)}</p>
            </div>
            {!n.is_read && (
              <button className="whitespace-nowrap text-xs font-medium text-brand-700 hover:underline" onClick={() => markRead.mutate(n.id)}>
                Mark read
              </button>
            )}
          </div>
        ))}
        {notifications && notifications.length === 0 && <p className="text-slate-500">No notifications yet.</p>}
      </div>
    </div>
  );
}
