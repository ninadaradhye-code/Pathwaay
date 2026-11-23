import { supabase } from "@/integrations/supabase/client";

/**
 * Typed wrappers for the admin console's database functions
 * (20261125090000_admin_console.sql). Every one of them checks the caller's
 * role on the server; the browser only decides what to show.
 */

type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
const call: Rpc = async <T>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await (
    supabase.rpc as unknown as (
      f: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(fn, args);
  if (error) {
    if (
      /admin_|schema cache|does not exist/i.test(error.message) &&
      !/Admin access/i.test(error.message)
    ) {
      throw new Error(
        "The admin console needs its database update. Run 20261125090000_admin_console.sql in Supabase.",
      );
    }
    throw new Error(error.message);
  }
  return data;
};

export interface Overview {
  online_now: number;
  live_classrooms: number;
  live_sessions: number;
  in_sessions: number;
  open_reports: number;
  auto_flags_24h: number;
  suspended_now: number;
  muted_now: number;
  students_total: number;
  signups_7d: number;
  sessions_7d: number;
  ratings_7d: number;
  solved_7d: number;
}

export interface ReportRow {
  id: string;
  created_at: string;
  reason: string;
  notes: string | null;
  automatic: boolean;
  reporter_id: string | null;
  reporter_name: string | null;
  reported_id: string | null;
  reported_name: string | null;
  reported_email: string | null;
  reported_suspended_until: string | null;
  reports_against: number;
  resolved_at: string | null;
  resolution: string | null;
  resolver_name: string | null;
}

export interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
  created_at: string;
  onboarded: boolean;
  suspended_until: string | null;
  roles: string[];
  solved: number;
  reports_against: number;
  chat_strikes_10m: number;
  online: boolean;
}

export interface UserDetail {
  profile: {
    id: string;
    name: string | null;
    email: string | null;
    college: string | null;
    course: string | null;
    year: string | null;
    avatar_url: string | null;
    created_at: string;
    onboarded_at: string | null;
    suspended_until: string | null;
  };
  roles: string[];
  stats: {
    solved: number;
    ratings: number;
    avg_rating: number | null;
    sessions: number;
    reports_made: number;
  };
  online_in: { classroom_id: string; subject: string | null; room: number } | null;
  reports_against: Array<{
    id: string;
    created_at: string;
    reason: string;
    notes: string | null;
    automatic: boolean;
    reporter_name: string | null;
    resolution: string | null;
    resolved_at: string | null;
  }>;
  chat_strikes: Array<{ created_at: string; subject: string | null }>;
  history: Array<{
    created_at: string;
    action: string;
    details: Record<string, unknown>;
    actor_name: string | null;
  }>;
}

export interface LiveData {
  classrooms: Array<{
    id: string;
    room_number: number;
    capacity: number;
    subject: string | null;
    count: number;
    people: Array<{ user_id: string; name: string; since: string }>;
  }>;
  sessions: Array<{
    id: string;
    topic: string;
    host_name: string;
    created_at: string;
    subject: string | null;
    room_number: number | null;
    people: Array<{ user_id: string; name: string; is_host: boolean }>;
  }>;
}

export interface ChatActivity {
  muted: Array<{ user_id: string; name: string; until: string }>;
  strikes: Array<{
    user_id: string;
    name: string;
    created_at: string;
    subject: string | null;
    room_number: number | null;
  }>;
}

export interface AuditRow {
  id: string;
  created_at: string;
  action: string;
  details: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  target_id: string | null;
  target_name: string | null;
}

export type ReportAction = "dismiss" | "warn" | "suspend" | "ban";
export type BlockMatch = "word" | "prefix" | "any";

export const adminApi = {
  overview: () => call<Overview>("admin_overview"),
  reports: (status: "open" | "resolved" | "all") =>
    call<ReportRow[]>("admin_list_reports", { _status: status, _limit: 200 }),
  resolveReport: (id: string, action: ReportAction, days?: number, note?: string) =>
    call<void>("admin_resolve_report", {
      _report_id: id,
      _action: action,
      _days: days ?? null,
      _note: note || null,
    }),
  users: (q: string, filter: "all" | "suspended" | "staff" | "flagged", offset = 0) =>
    call<UserRow[]>("admin_search_users", { _q: q, _filter: filter, _limit: 50, _offset: offset }),
  user: (id: string) => call<UserDetail>("admin_user_detail", { _user_id: id }),
  setSuspension: (id: string, until: Date | null, reason?: string) =>
    call<void>("admin_set_suspension", {
      _user_id: id,
      _until: until ? until.toISOString() : null,
      _reason: reason || null,
    }),
  setRole: (id: string, role: "moderator" | "admin", grant: boolean) =>
    call<void>("admin_set_role", { _user_id: id, _role: role, _grant: grant }),
  live: () => call<LiveData>("admin_live"),
  endSession: (id: string) => call<void>("admin_end_private_session", { _session_id: id }),
  chat: () => call<ChatActivity>("admin_chat_activity"),
  unmute: (id: string) => call<void>("admin_unmute", { _user_id: id }),
  blockedTerms: () => call<Array<{ term: string; match: BlockMatch }>>("admin_list_blocked_terms"),
  setBlockedTerm: (term: string, match: BlockMatch, remove = false) =>
    call<void>("admin_set_blocked_term", { _term: term, _match: match, _remove: remove }),
  audit: (action?: string) =>
    call<AuditRow[]>("admin_audit_log", { _action: action || null, _limit: 300 }),
};

/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? "day" : "days"} ago`;
}

/** A suspension far in the future is a ban. */
export function isBan(until: string | null | undefined) {
  return !!until && new Date(until).getTime() - Date.now() > 50 * 365 * 86400 * 1000;
}

export function untilLabel(until: string | null | undefined) {
  if (!until || new Date(until).getTime() <= Date.now()) return null;
  if (isBan(until)) return "Banned";
  return `Suspended until ${new Date(until).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

const ACTION_LABEL: Record<string, string> = {
  suspend: "Suspended",
  unsuspend: "Lifted suspension",
  ban: "Banned",
  warn: "Warned",
  dismiss: "Dismissed report",
  auto_suspend: "Auto-suspended (3 reports)",
  grant_moderator: "Made moderator",
  revoke_moderator: "Removed moderator",
  grant_admin: "Made admin",
  revoke_admin: "Removed admin",
  end_private_session: "Ended private session",
  unmute: "Unmuted in chat",
  add_blocked_word: "Added blocked word",
  remove_blocked_word: "Removed blocked word",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, " ");

export const REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  abuse: "Abuse",
  off_topic: "Off topic",
  wrong_answer: "Wrong answer",
  other: "Other",
};
