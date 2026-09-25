import { apiClient } from "./client";
import type {
  Account,
  BorrowingCapacityOut,
  BorrowingCapacityRequest,
  BudgetProgress,
  Category,
  CreditProfile,
  CreditRecommendationsOut,
  CreditScoreHistoryPoint,
  DashboardSummary,
  Goal,
  Household,
  Notification,
  RecurringBill,
  Transaction,
  User,
} from "../types";

export const AuthApi = {
  login: (email: string, password: string) =>
    apiClient.post<{ access_token: string }>("/auth/login", { email, password }).then((r) => r.data),
  signup: (payload: { full_name: string; email: string; password: string; household_name?: string; invite_code?: string }) =>
    apiClient.post<{ access_token: string }>("/auth/signup", payload).then((r) => r.data),
  me: () => apiClient.get<User>("/auth/me").then((r) => r.data),
};

export const HouseholdApi = {
  get: () => apiClient.get<Household>("/household").then((r) => r.data),
  update: (payload: Partial<Pick<Household, "name" | "annual_gross_income">>) =>
    apiClient.patch<Household>("/household", payload).then((r) => r.data),
  members: () => apiClient.get<User[]>("/household/members").then((r) => r.data),
};

export const AccountsApi = {
  list: () => apiClient.get<Account[]>("/accounts").then((r) => r.data),
  create: (payload: Partial<Account>) => apiClient.post<Account>("/accounts", payload).then((r) => r.data),
  update: (id: string, payload: Partial<Account>) => apiClient.patch<Account>(`/accounts/${id}`, payload).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/accounts/${id}`),
};

export const CategoriesApi = {
  list: () => apiClient.get<Category[]>("/categories").then((r) => r.data),
  create: (payload: { name: string; type: string; icon?: string }) =>
    apiClient.post<Category>("/categories", payload).then((r) => r.data),
};

export const TransactionsApi = {
  list: (params: Record<string, string | number | undefined> = {}) =>
    apiClient.get<Transaction[]>("/transactions", { params }).then((r) => r.data),
  create: (payload: Partial<Transaction>) => apiClient.post<Transaction>("/transactions", payload).then((r) => r.data),
  update: (id: string, payload: Partial<Transaction>) =>
    apiClient.patch<Transaction>(`/transactions/${id}`, payload).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/transactions/${id}`),
};

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
