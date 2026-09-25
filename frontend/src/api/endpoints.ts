import { apiClient } from "./client";

// Migrated to Firebase. The rest below still call the old Python API until their stage is moved.
export { AuthApi, HouseholdApi } from "../firebase/household";
export { AccountsApi, CategoriesApi, TransactionsApi } from "../firebase/ledger";
import type {
  Account,
  BorrowingCapacityOut,
  BorrowingCapacityRequest,
  BudgetProgress,
  CreditProfile,
  CreditRecommendationsOut,
  CreditScoreHistoryPoint,
  DashboardSummary,
  Goal,
  Notification,
  RecurringBill,
} from "../types";

export const BudgetsApi = {
  list: (month?: string) => apiClient.get<BudgetProgress[]>("/budgets", { params: { month } }).then((r) => r.data),
  create: (payload: { category_id: string; month: string; amount_limit: number }) =>
    apiClient.post("/budgets", payload).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/budgets/${id}`),
};

export const GoalsApi = {
  list: () => apiClient.get<Goal[]>("/goals").then((r) => r.data),
  create: (payload: Partial<Goal>) => apiClient.post<Goal>("/goals", payload).then((r) => r.data),
  update: (id: string, payload: Partial<Goal>) => apiClient.patch<Goal>(`/goals/${id}`, payload).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/goals/${id}`),
};

export const RecurringBillsApi = {
  list: () => apiClient.get<RecurringBill[]>("/recurring-bills").then((r) => r.data),
  create: (payload: Partial<RecurringBill>) => apiClient.post<RecurringBill>("/recurring-bills", payload).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/recurring-bills/${id}`),
};

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

export const DashboardApi = {
  summary: () => apiClient.get<DashboardSummary>("/dashboard/summary").then((r) => r.data),
};

export const CreditApi = {
  listProfiles: () => apiClient.get<CreditProfile[]>("/credit/profiles").then((r) => r.data),
  upsertProfile: (userId: string, payload: Partial<CreditProfile> & { recorded_date?: string }) =>
    apiClient.put<CreditProfile>(`/credit/profiles/${userId}`, payload).then((r) => r.data),
  history: (userId: string) => apiClient.get<CreditScoreHistoryPoint[]>(`/credit/profiles/${userId}/history`).then((r) => r.data),
  recommendations: (userId: string) =>
    apiClient.get<CreditRecommendationsOut>(`/credit/profiles/${userId}/recommendations`).then((r) => r.data),
  borrowingCapacity: (payload: BorrowingCapacityRequest) =>
    apiClient.post<BorrowingCapacityOut>("/credit/borrowing-capacity", payload).then((r) => r.data),
};
