export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      answers: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          doubt_id: string;
          id: string;
          rating: number | null;
          status: Database["public"]["Enums"]["answer_status"];
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          doubt_id: string;
          id?: string;
          rating?: number | null;
          status?: Database["public"]["Enums"]["answer_status"];
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          doubt_id?: string;
          id?: string;
          rating?: number | null;
          status?: Database["public"]["Enums"]["answer_status"];
        };
        Relationships: [
          {
            foreignKeyName: "answers_doubt_id_fkey";
            columns: ["doubt_id"];
            isOneToOne: false;
            referencedRelation: "doubts";
            referencedColumns: ["id"];
          },
        ];
      };
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
          id: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
          id?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
          id?: string;
        };
        Relationships: [];
      };
      classroom_messages: {
        Row: {
          author_id: string;
          author_name: string;
          body: string;
          classroom_id: string;
          created_at: string;
          id: string;
          kind: "chat" | "doubt";
          resolved_at: string | null;
        };
        Insert: {
          author_id: string;
          author_name?: string;
          body: string;
          classroom_id: string;
          created_at?: string;
          id?: string;
          kind?: "chat" | "doubt";
          resolved_at?: string | null;
        };
        Update: {
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "classroom_messages_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
        ];
      };
      private_session_media: {
        Row: {
          cf_session_id: string;
          pulled_mids: string[];
          session_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cf_session_id: string;
          pulled_mids?: string[];
          session_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cf_session_id?: string;
          pulled_mids?: string[];
          session_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      private_session_participants: {
        Row: {
          cam_on: boolean;
          classroom_id: string;
          host_muted: boolean;
          is_host: boolean;
          joined_at: string;
          last_seen: string;
          media_version: number;
          mic_on: boolean;
          name: string;
          session_id: string;
          status: "joined" | "left" | "removed";
          user_id: string;
        };
        Insert: {
          cam_on?: boolean;
          classroom_id: string;
          host_muted?: boolean;
          is_host?: boolean;
          joined_at?: string;
          last_seen?: string;
          media_version?: number;
          mic_on?: boolean;
          name?: string;
          session_id: string;
          status?: "joined" | "left" | "removed";
          user_id: string;
        };
        Update: {
          cam_on?: boolean;
          host_muted?: boolean;
          last_seen?: string;
          media_version?: number;
          mic_on?: boolean;
          name?: string;
          status?: "joined" | "left" | "removed";
        };
        Relationships: [
          {
            foreignKeyName: "private_session_participants_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "private_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      private_sessions: {
        Row: {
          classroom_id: string;
          created_at: string;
          doubt_id: string | null;
          ended_at: string | null;
          host_id: string;
          host_name: string;
          id: string;
          started_by: string;
          started_by_name: string;
          status: "live" | "ended";
          topic: string;
        };
        Insert: {
          classroom_id: string;
          created_at?: string;
          doubt_id?: string | null;
          ended_at?: string | null;
          host_id: string;
          host_name?: string;
          id?: string;
          started_by: string;
          started_by_name?: string;
          status?: "live" | "ended";
          topic: string;
        };
        Update: {
          ended_at?: string | null;
          status?: "live" | "ended";
        };
        Relationships: [
          {
            foreignKeyName: "private_sessions_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
        ];
      };
      classrooms: {
        Row: {
          capacity: number;
          created_at: string;
          id: string;
          is_verified: boolean;
          room_number: number;
          status: string;
          subject_slug: string;
        };
        Insert: {
          capacity?: number;
          created_at?: string;
          id?: string;
          is_verified?: boolean;
          room_number: number;
          status?: string;
          subject_slug: string;
        };
        Update: {
          capacity?: number;
          created_at?: string;
          id?: string;
          is_verified?: boolean;
          room_number?: number;
          status?: string;
          subject_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "classrooms_subject_slug_fkey";
            columns: ["subject_slug"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["slug"];
          },
        ];
      };
      courses: {
        Row: {
          created_at: string;
          degree: string;
          duration_years: number;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          degree: string;
          duration_years: number;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          degree?: string;
          duration_years?: number;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      course_subjects: {
        Row: {
          course_slug: string;
          id: string;
          semester: number;
          sort_order: number;
          subject_slug: string;
        };
        Insert: {
          course_slug: string;
          id?: string;
          semester: number;
          sort_order?: number;
          subject_slug: string;
        };
        Update: {
          course_slug?: string;
          id?: string;
          semester?: number;
          sort_order?: number;
          subject_slug?: string;
        };
        Relationships: [];
      };
      course_subject_map: {
        Row: {
          course_key: string;
          id: string;
          is_recommended: boolean;
          sort_order: number;
          subject_slug: string;
        };
        Insert: {
          course_key: string;
          id?: string;
          is_recommended?: boolean;
          sort_order?: number;
          subject_slug: string;
        };
        Update: {
          course_key?: string;
          id?: string;
          is_recommended?: boolean;
          sort_order?: number;
          subject_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_subject_map_subject_slug_fkey";
            columns: ["subject_slug"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["slug"];
          },
        ];
      };
      doubts: {
        Row: {
          author_id: string;
          body: string;
          classroom_id: string;
          created_at: string;
          id: string;
          is_resolved: boolean;
        };
        Insert: {
          author_id: string;
          body: string;
          classroom_id: string;
          created_at?: string;
          id?: string;
          is_resolved?: boolean;
        };
        Update: {
          author_id?: string;
          body?: string;
          classroom_id?: string;
          created_at?: string;
          id?: string;
          is_resolved?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "doubts_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          status: Database["public"]["Enums"]["friend_status"];
          updated_at: string;
        };
        Insert: {
          addressee_id: string;
          created_at?: string;
          id?: string;
          requester_id: string;
          status?: Database["public"]["Enums"]["friend_status"];
          updated_at?: string;
        };
        Update: {
          addressee_id?: string;
          created_at?: string;
          id?: string;
          requester_id?: string;
          status?: Database["public"]["Enums"]["friend_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      moderation_log: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          details: Json | null;
          id: string;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_id: string;
          created_at?: string;
          details?: Json | null;
          id?: string;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string;
          created_at?: string;
          details?: Json | null;
          id?: string;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          college: string;
          course: string;
          course_slug: string | null;
          created_at: string;
          degree: string | null;
          dob: string | null;
          email: string;
          id: string;
          name: string;
          onboarded_at: string | null;
          suspended_until: string | null;
          updated_at: string;
          year: string;
        };
        Insert: {
          avatar_url?: string | null;
          college?: string;
          course?: string;
          course_slug?: string | null;
          created_at?: string;
          degree?: string | null;
          dob?: string | null;
          email?: string;
          id: string;
          name?: string;
          onboarded_at?: string | null;
          suspended_until?: string | null;
          updated_at?: string;
          year?: string;
        };
        Update: {
          avatar_url?: string | null;
          college?: string;
          course?: string;
          course_slug?: string | null;
          created_at?: string;
          degree?: string | null;
          dob?: string | null;
          email?: string;
          id?: string;
          name?: string;
          onboarded_at?: string | null;
          suspended_until?: string | null;
          updated_at?: string;
          year?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          answer_id: string | null;
          created_at: string;
          doubt_id: string | null;
          id: string;
          notes: string | null;
          reason: Database["public"]["Enums"]["report_reason"];
          reported_user_id: string | null;
          reporter_id: string;
        };
        Insert: {
          answer_id?: string | null;
          created_at?: string;
          doubt_id?: string | null;
          id?: string;
          notes?: string | null;
          reason: Database["public"]["Enums"]["report_reason"];
          reported_user_id?: string | null;
          reporter_id: string;
        };
        Update: {
          answer_id?: string | null;
          created_at?: string;
          doubt_id?: string | null;
          id?: string;
          notes?: string | null;
          reason?: Database["public"]["Enums"]["report_reason"];
          reported_user_id?: string | null;
          reporter_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_answer_id_fkey";
            columns: ["answer_id"];
            isOneToOne: false;
            referencedRelation: "answers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_doubt_id_fkey";
            columns: ["doubt_id"];
            isOneToOne: false;
            referencedRelation: "doubts";
            referencedColumns: ["id"];
          },
        ];
      };
      session_ratings: {
        Row: {
          classroom_id: string | null;
          comment: string | null;
          created_at: string;
          id: string;
          ratee_id: string | null;
          rater_id: string;
          score: number;
          solved: string | null;
        };
        Insert: {
          classroom_id?: string | null;
          comment?: string | null;
          created_at?: string;
          id?: string;
          ratee_id?: string | null;
          rater_id: string;
          score: number;
          solved?: string | null;
        };
        Update: {
          classroom_id?: string | null;
          comment?: string | null;
          created_at?: string;
          id?: string;
          ratee_id?: string | null;
          rater_id?: string;
          score?: number;
          solved?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "session_ratings_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
        ];
      };
      subjects: {
        Row: {
          category: string;
          created_at: string;
          name: string;
          slug: string;
        };
        Insert: {
          category?: string;
          created_at?: string;
          name: string;
          slug: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      user_presence: {
        Row: {
          classroom_id: string | null;
          last_seen: string;
          subject_slug: string | null;
          user_id: string;
        };
        Insert: {
          classroom_id?: string | null;
          last_seen?: string;
          subject_slug?: string | null;
          user_id: string;
        };
        Update: {
          classroom_id?: string | null;
          last_seen?: string;
          subject_slug?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_presence_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cleanup_old_doubts: { Args: never; Returns: undefined };
      heartbeat_private_session: {
        Args: { p_session_id: string; p_user_id: string; p_mic: boolean; p_cam: boolean };
        Returns: { participant_status: string; host_muted: boolean; session_status: string }[];
      };
      is_classroom_member: { Args: { _classroom_id: string }; Returns: boolean };
      is_private_session_participant: { Args: { _session_id: string }; Returns: boolean };
      join_private_session: {
        Args: { p_session_id: string; p_user_id: string; p_name: string; p_max?: number };
        Returns: boolean;
      };
      leave_private_session: {
        Args: { p_session_id: string; p_user_id: string };
        Returns: boolean;
      };
      mark_private_media_published: {
        Args: { p_session_id: string; p_user_id: string };
        Returns: undefined;
      };
      moderate_private_session: {
        Args: {
          p_session_id: string;
          p_host_id: string;
          p_target: string | null;
          p_action: "mute" | "unmute" | "remove" | "mute_all";
        };
        Returns: undefined;
      };
      start_help_session: {
        Args: { p_doubt_id: string; p_helper_id: string; p_helper_name: string };
        Returns: string;
      };
      sweep_private_sessions: { Args: Record<string, never>; Returns: undefined };
      get_friends: {
        Args: { _user_id: string };
        Returns: {
          avatar_url: string;
          classroom_id: string;
          college: string;
          course: string;
          direction: string;
          friend_id: string;
          name: string;
          online: boolean;
          room_number: number;
          status: Database["public"]["Enums"]["friend_status"];
          subject_name: string;
          year: string;
        }[];
      };
      get_leaderboard: {
        Args: { _limit?: number };
        Returns: {
          avatar_url: string;
          avg_rating: number;
          course: string;
          name: string;
          ratings_count: number;
          solved: number;
          user_id: string;
        }[];
      };
      get_my_stats: {
        Args: { _user_id: string };
        Returns: {
          answers_given: number;
          avg_rating: number;
          doubts_asked: number;
          friends: number;
          rank: number;
          ratings_count: number;
          solved: number;
        }[];
      };
      get_public_profile: {
        Args: { _user_id: string };
        Returns: {
          avatar_url: string;
          college: string;
          course: string;
          id: string;
          name: string;
          year: string;
        }[];
      };
      get_course_subjects: {
        Args: { _course_slug: string; _year: number };
        Returns: { name: string; slug: string; sort_order: number }[];
      };
      record_moderation_strike: {
        Args: { _kind: string; _classroom_id?: string | null; _score?: number | null };
        Returns: { strike_count: number; banned_until: string | null }[];
      };
      get_public_profiles: {
        Args: { _user_ids: string[] };
        Returns: {
          avatar_url: string;
          college: string;
          course: string;
          id: string;
          name: string;
          year: string;
        }[];
      };
      get_room_presence: {
        Args: { _classroom_id: string };
        Returns: { last_seen: string; user_id: string }[];
      };
      get_classroom_counts: {
        Args: { _subject_slug: string };
        Returns: { classroom_id: string; live: number }[];
      };
      get_subject_counts: {
        Args: Record<string, never>;
        Returns: { live: number; subject_slug: string }[];
      };
      sweep_stale_presence: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      get_suspended_profiles: {
        Args: { _limit?: number };
        Returns: {
          email: string;
          id: string;
          name: string;
          suspended_until: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      answer_status: "pending" | "accepted" | "rejected";
      app_role: "user" | "moderator" | "admin";
      friend_status: "pending" | "accepted" | "declined";
      report_reason: "spam" | "abuse" | "off_topic" | "wrong_answer" | "other";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      answer_status: ["pending", "accepted", "rejected"],
      app_role: ["user", "moderator", "admin"],
      friend_status: ["pending", "accepted", "declined"],
      report_reason: ["spam", "abuse", "off_topic", "wrong_answer", "other"],
    },
  },
} as const;
