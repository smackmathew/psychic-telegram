import { apiClient } from "./client";

// Migrated to Firebase. The rest below still call the old Python API until their stage is moved.
export { AuthApi, HouseholdApi } from "../firebase/household";
export { AccountsApi, CategoriesApi, TransactionsApi } from "../firebase/ledger";
export { BudgetsApi, GoalsApi, RecurringBillsApi } from "../firebase/planning";
export { DashboardApi } from "../firebase/dashboard";
export { CreditApi } from "../firebase/credit";
import type {
  Account,
  Notification,
} from "../types";

export const NotificationsApi = {
  list: (unreadOnly = false) =>
    apiClient.get<Notification[]>("/notifications", { params: { unread_only: unreadOnly } }).then((r) => r.data),
  markRead: (id: string) => apiClient.post<Notification>(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => apiClient.post("/notifications/read-all"),
  runChecks: () => apiClient.post<Notification[]>("/notifications/run-checks").then((r) => r.data),
};

export const PlaidApi = {
  status: () => apiClient.get<{ enabled: boolean; environment: string }>("/plaid/status").then((r) => r.data),
  createLinkToken: () => apiClient.post<{ link_token: string }>("/plaid/link-token").then((r) => r.data),
  exchangePublicToken: (public_token: string, institution_name?: string) =>
    apiClient.post<Account[]>("/plaid/exchange-public-token", { public_token, institution_name }).then((r) => r.data),
  sync: () => apiClient.post("/plaid/sync"),
};
