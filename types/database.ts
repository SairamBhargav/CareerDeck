// Generated from the local database by `npm run types:generate` — do not edit by hand.
// Regenerate after every migration; the client is typed against this file.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      application_events: {
        Row: {
          application_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["application_status"] | null
          id: number
          to_status: Database["public"]["Enums"]["application_status"]
        }
        Insert: {
          application_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["application_status"] | null
          id?: never
          to_status: Database["public"]["Enums"]["application_status"]
        }
        Update: {
          application_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["application_status"] | null
          id?: never
          to_status?: Database["public"]["Enums"]["application_status"]
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string
          auto_apply_run_id: string | null
          created_at: string
          id: string
          job_id: string
          notes: string | null
          self_reported: boolean
          source: Database["public"]["Enums"]["application_source"]
          status: Database["public"]["Enums"]["application_status"]
          status_changed_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          auto_apply_run_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          notes?: string | null
          self_reported?: boolean
          source: Database["public"]["Enums"]["application_source"]
          status?: Database["public"]["Enums"]["application_status"]
          status_changed_at?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          applied_at?: string
          auto_apply_run_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          notes?: string | null
          self_reported?: boolean
          source?: Database["public"]["Enums"]["application_source"]
          status?: Database["public"]["Enums"]["application_status"]
          status_changed_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_auto_apply_run_id_fkey"
            columns: ["auto_apply_run_id"]
            isOneToOne: false
            referencedRelation: "auto_apply_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_apply_runs: {
        Row: {
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          draft: Json | null
          edited_fields: string[] | null
          error: string | null
          form: Json | null
          form_source: string | null
          id: string
          job_id: string
          model: string | null
          prompt_version: string | null
          resume_id: string
          reviewed_at: string | null
          status: Database["public"]["Enums"]["auto_apply_status"]
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          draft?: Json | null
          edited_fields?: string[] | null
          error?: string | null
          form?: Json | null
          form_source?: string | null
          id?: string
          job_id: string
          model?: string | null
          prompt_version?: string | null
          resume_id: string
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["auto_apply_status"]
          tokens_in?: number | null
          tokens_out?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          draft?: Json | null
          edited_fields?: string[] | null
          error?: string | null
          form?: Json | null
          form_source?: string | null
          id?: string
          job_id?: string
          model?: string | null
          prompt_version?: string | null
          resume_id?: string
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["auto_apply_status"]
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_apply_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_apply_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_apply_runs_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_apply_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          app_user_id: string | null
          id: string
          outcome: string | null
          payload: Json
          received_at: string
          type: string
          user_id: string | null
        }
        Insert: {
          app_user_id?: string | null
          id: string
          outcome?: string | null
          payload: Json
          received_at?: string
          type: string
          user_id?: string | null
        }
        Update: {
          app_user_id?: string | null
          id?: string
          outcome?: string | null
          payload?: Json
          received_at?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          gif_id: string | null
          id: string
          idempotency_key: string | null
          job_id: string
          like_count: number
          moderation_reason: string | null
          moderation_scores: Json | null
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          parent_id: string | null
          reply_count: number
        }
        Insert: {
          author_id: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          gif_id?: string | null
          id?: string
          idempotency_key?: string | null
          job_id: string
          like_count?: number
          moderation_reason?: string | null
          moderation_scores?: Json | null
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          parent_id?: string | null
          reply_count?: number
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          gif_id?: string | null
          id?: string
          idempotency_key?: string | null
          job_id?: string
          like_count?: number
          moderation_reason?: string | null
          moderation_scores?: Json | null
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          parent_id?: string | null
          reply_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments_public"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          claimed_by_org_id: string | null
          created_at: string
          description: string | null
          domain: string | null
          employee_range: string | null
          follower_count: number
          hq_location: string | null
          id: string
          industry: string | null
          is_active: boolean
          legal_name: string | null
          logo_color: string | null
          logo_monogram: string | null
          logo_url: string | null
          name: string
          open_job_count: number
          slug: string
          updated_at: string
        }
        Insert: {
          claimed_by_org_id?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          employee_range?: string | null
          follower_count?: number
          hq_location?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          legal_name?: string | null
          logo_color?: string | null
          logo_monogram?: string | null
          logo_url?: string | null
          name: string
          open_job_count?: number
          slug: string
          updated_at?: string
        }
        Update: {
          claimed_by_org_id?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          employee_range?: string | null
          follower_count?: number
          hq_location?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          legal_name?: string | null
          logo_color?: string | null
          logo_monogram?: string | null
          logo_url?: string | null
          name?: string
          open_job_count?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_follows: {
        Row: {
          company_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_follows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crawl_runs: {
        Row: {
          collapsed: number
          duplicates: number
          error: string | null
          finished_at: string | null
          http_status: number | null
          id: string
          jobs_closed: number
          jobs_created: number
          jobs_updated: number
          postings_seen: number
          raw_inserted: number
          source_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          collapsed?: number
          duplicates?: number
          error?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          jobs_closed?: number
          jobs_created?: number
          jobs_updated?: number
          postings_seen?: number
          raw_inserted?: number
          source_id?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          collapsed?: number
          duplicates?: number
          error?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          jobs_closed?: number
          jobs_created?: number
          jobs_updated?: number
          postings_seen?: number
          raw_inserted?: number
          source_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawl_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          grant_period: number | null
          id: number
          idempotency_key: string
          kind: Database["public"]["Enums"]["credit_kind"]
          ref_id: string | null
          ref_type: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          grant_period?: number | null
          id?: never
          idempotency_key: string
          kind: Database["public"]["Enums"]["credit_kind"]
          ref_id?: string | null
          ref_type?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          grant_period?: number | null
          id?: never
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["credit_kind"]
          ref_id?: string | null
          ref_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      data_exports: {
        Row: {
          bytes: number | null
          completed_at: string | null
          id: string
          requested_at: string
          user_id: string
        }
        Insert: {
          bytes?: number | null
          completed_at?: string | null
          id?: string
          requested_at?: string
          user_id: string
        }
        Update: {
          bytes?: number | null
          completed_at?: string | null
          id?: string
          requested_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          id: string
          purge_after: string
          purge_detail: Json | null
          requested_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          purge_after?: string
          purge_detail?: Json | null
          requested_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          purge_after?: string
          purge_detail?: Json | null
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      digest_sends: {
        Row: {
          claimed_at: string
          error: string | null
          provider_id: string | null
          sent_at: string | null
          status: string
          user_id: string
          week_start: string
        }
        Insert: {
          claimed_at?: string
          error?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          user_id: string
          week_start: string
        }
        Update: {
          claimed_at?: string
          error?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          expires_at: string | null
          feature: string
          source: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          expires_at?: string | null
          feature: string
          source: string
          updated_at?: string
          user_id: string
          value?: Json
        }
        Update: {
          expires_at?: string | null
          feature?: string
          source?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_experiments: {
        Row: {
          is_running: boolean
          name: string
          notes: string | null
          started_at: string
          stopped_at: string | null
          treatment_pct: number
        }
        Insert: {
          is_running?: boolean
          name: string
          notes?: string | null
          started_at?: string
          stopped_at?: string | null
          treatment_pct?: number
        }
        Update: {
          is_running?: boolean
          name?: string
          notes?: string | null
          started_at?: string
          stopped_at?: string | null
          treatment_pct?: number
        }
        Relationships: []
      }
      feed_sessions: {
        Row: {
          arm: Database["public"]["Enums"]["feed_arm"]
          components: Json
          created_at: string
          cursor: number
          experiment: string | null
          expires_at: string
          id: string
          job_ids: string[]
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          arm?: Database["public"]["Enums"]["feed_arm"]
          components?: Json
          created_at?: string
          cursor?: number
          experiment?: string | null
          expires_at?: string
          id?: string
          job_ids: string[]
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          arm?: Database["public"]["Enums"]["feed_arm"]
          components?: Json
          created_at?: string
          cursor?: number
          experiment?: string | null
          expires_at?: string
          id?: string
          job_ids?: string[]
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      handle_words: {
        Row: {
          kind: string
          word: string
        }
        Insert: {
          kind: string
          word: string
        }
        Update: {
          kind?: string
          word?: string
        }
        Relationships: []
      }
      job_dedup_review: {
        Row: {
          created_at: string
          id: string
          job_id: string
          other_job_id: string
          resolution: string
          resolved_at: string | null
          signal: string
          similarity: number
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          other_job_id: string
          resolution?: string
          resolved_at?: string | null
          signal: string
          similarity: number
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          other_job_id?: string
          resolution?: string
          resolved_at?: string | null
          signal?: string
          similarity?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_dedup_review_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dedup_review_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dedup_review_other_job_id_fkey"
            columns: ["other_job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dedup_review_other_job_id_fkey"
            columns: ["other_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_impressions: {
        Row: {
          completed: boolean | null
          dwell_ms: number | null
          job_id: string
          position: number | null
          session_id: string
          shown_at: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id: string
          position?: number | null
          session_id: string
          shown_at?: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id?: string
          position?: number | null
          session_id?: string
          shown_at?: string
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: []
      }
      job_impressions_2026_09: {
        Row: {
          completed: boolean | null
          dwell_ms: number | null
          job_id: string
          position: number | null
          session_id: string
          shown_at: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id: string
          position?: number | null
          session_id: string
          shown_at?: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id?: string
          position?: number | null
          session_id?: string
          shown_at?: string
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: []
      }
      job_impressions_2026_10: {
        Row: {
          completed: boolean | null
          dwell_ms: number | null
          job_id: string
          position: number | null
          session_id: string
          shown_at: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id: string
          position?: number | null
          session_id: string
          shown_at?: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id?: string
          position?: number | null
          session_id?: string
          shown_at?: string
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: []
      }
      job_impressions_2026_11: {
        Row: {
          completed: boolean | null
          dwell_ms: number | null
          job_id: string
          position: number | null
          session_id: string
          shown_at: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id: string
          position?: number | null
          session_id: string
          shown_at?: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id?: string
          position?: number | null
          session_id?: string
          shown_at?: string
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: []
      }
      job_impressions_2026_12: {
        Row: {
          completed: boolean | null
          dwell_ms: number | null
          job_id: string
          position: number | null
          session_id: string
          shown_at: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id: string
          position?: number | null
          session_id: string
          shown_at?: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id?: string
          position?: number | null
          session_id?: string
          shown_at?: string
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: []
      }
      job_impressions_default: {
        Row: {
          completed: boolean | null
          dwell_ms: number | null
          job_id: string
          position: number | null
          session_id: string
          shown_at: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id: string
          position?: number | null
          session_id: string
          shown_at?: string
          surface: Database["public"]["Enums"]["feed_surface"]
          user_id: string
        }
        Update: {
          completed?: boolean | null
          dwell_ms?: number | null
          job_id?: string
          position?: number | null
          session_id?: string
          shown_at?: string
          surface?: Database["public"]["Enums"]["feed_surface"]
          user_id?: string
        }
        Relationships: []
      }
      job_interactions: {
        Row: {
          created_at: string
          job_id: string
          kind: Database["public"]["Enums"]["interaction_kind"]
          user_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
          kind: Database["public"]["Enums"]["interaction_kind"]
          user_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["interaction_kind"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_interactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_interactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_interactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_match_scores: {
        Row: {
          components: Json
          computed_at: string
          job_id: string
          resume_id: string
          score: number
          user_id: string
        }
        Insert: {
          components: Json
          computed_at?: string
          job_id: string
          resume_id: string
          score: number
          user_id: string
        }
        Update: {
          components?: Json
          computed_at?: string
          job_id?: string
          resume_id?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_match_scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_scores_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          board_token: string | null
          board_url: string
          company_id: string | null
          consecutive_failures: number
          crawl_interval: string
          created_at: string
          enabled: boolean
          etag: string | null
          id: string
          kind: Database["public"]["Enums"]["ats_kind"]
          last_crawled_at: string | null
          last_success_at: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          board_token?: string | null
          board_url: string
          company_id?: string | null
          consecutive_failures?: number
          crawl_interval?: string
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          kind: Database["public"]["Enums"]["ats_kind"]
          last_crawled_at?: string | null
          last_success_at?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          board_token?: string | null
          board_url?: string
          company_id?: string | null
          consecutive_failures?: number
          crawl_interval?: string
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["ats_kind"]
          last_crawled_at?: string | null
          last_success_at?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_sources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          apply_host: string | null
          apply_url: string
          closes_at: string | null
          company_id: string
          company_name: string
          created_at: string
          dedup_group_id: string
          dedup_key: string | null
          description_html: string | null
          description_text: string
          embedding: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          external_id: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          location_city: string | null
          location_country: string | null
          location_raw: string | null
          location_region: string | null
          location_type: Database["public"]["Enums"]["location_type"]
          posted_at: string
          quality_score: number
          requirements: string[]
          run_id: string | null
          salary_annual_max: number | null
          salary_currency: string
          salary_is_estimated: boolean
          salary_max: number | null
          salary_min: number | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          search_vector: unknown
          seniority: Database["public"]["Enums"]["seniority_level"] | null
          skills: string[]
          source_id: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          title_normalized: string
          updated_at: string
        }
        Insert: {
          apply_host?: string | null
          apply_url: string
          closes_at?: string | null
          company_id: string
          company_name: string
          created_at?: string
          dedup_group_id?: string
          dedup_key?: string | null
          description_html?: string | null
          description_text: string
          embedding?: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          external_id?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          location_city?: string | null
          location_country?: string | null
          location_raw?: string | null
          location_region?: string | null
          location_type: Database["public"]["Enums"]["location_type"]
          posted_at?: string
          quality_score?: number
          requirements?: string[]
          run_id?: string | null
          salary_annual_max?: number | null
          salary_currency?: string
          salary_is_estimated?: boolean
          salary_max?: number | null
          salary_min?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          search_vector?: unknown
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          skills?: string[]
          source_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          title_normalized: string
          updated_at?: string
        }
        Update: {
          apply_host?: string | null
          apply_url?: string
          closes_at?: string | null
          company_id?: string
          company_name?: string
          created_at?: string
          dedup_group_id?: string
          dedup_key?: string | null
          description_html?: string | null
          description_text?: string
          embedding?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          external_id?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          location_city?: string | null
          location_country?: string | null
          location_raw?: string | null
          location_region?: string | null
          location_type?: Database["public"]["Enums"]["location_type"]
          posted_at?: string
          quality_score?: number
          requirements?: string[]
          run_id?: string | null
          salary_annual_max?: number | null
          salary_currency?: string
          salary_is_estimated?: boolean
          salary_max?: number | null
          salary_min?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          search_vector?: unknown
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          skills?: string[]
          source_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          title_normalized?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crawl_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      moderators: {
        Row: {
          can_ban: boolean
          created_at: string
          email: string | null
          user_id: string
        }
        Insert: {
          can_ban?: boolean
          created_at?: string
          email?: string | null
          user_id: string
        }
        Update: {
          can_ban?: boolean
          created_at?: string
          email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      news_items: {
        Row: {
          accent_color: string | null
          category: string
          company_id: string | null
          cost_usd: number | null
          created_at: string
          headline: string
          id: string
          image_url: string | null
          ingested_at: string
          model: string | null
          prompt_version: string | null
          published_at: string
          publisher: string
          relevance_score: number | null
          source_id: string | null
          status: string
          subtext: string | null
          summary: string[]
          tag: string
          tokens_in: number | null
          tokens_out: number | null
          topic: string
          url: string
          url_hash: string
        }
        Insert: {
          accent_color?: string | null
          category: string
          company_id?: string | null
          cost_usd?: number | null
          created_at?: string
          headline: string
          id?: string
          image_url?: string | null
          ingested_at?: string
          model?: string | null
          prompt_version?: string | null
          published_at: string
          publisher: string
          relevance_score?: number | null
          source_id?: string | null
          status?: string
          subtext?: string | null
          summary?: string[]
          tag: string
          tokens_in?: number | null
          tokens_out?: number | null
          topic?: string
          url: string
          url_hash: string
        }
        Update: {
          accent_color?: string | null
          category?: string
          company_id?: string | null
          cost_usd?: number | null
          created_at?: string
          headline?: string
          id?: string
          image_url?: string | null
          ingested_at?: string
          model?: string | null
          prompt_version?: string | null
          published_at?: string
          publisher?: string
          relevance_score?: number | null
          source_id?: string | null
          status?: string
          subtext?: string | null
          summary?: string[]
          tag?: string
          tokens_in?: number | null
          tokens_out?: number | null
          topic?: string
          url?: string
          url_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "news_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      news_seen: {
        Row: {
          news_item_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          news_item_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          news_item_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_seen_news_item_id_fkey"
            columns: ["news_item_id"]
            isOneToOne: false
            referencedRelation: "news_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_seen_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      news_sources: {
        Row: {
          category: string
          company_id: string | null
          company_slug: string | null
          consecutive_failures: number
          created_at: string
          enabled: boolean
          etag: string | null
          id: string
          kind: string
          last_fetched_at: string | null
          last_success_at: string | null
          name: string
          notes: string | null
          publisher: string
          url: string
        }
        Insert: {
          category: string
          company_id?: string | null
          company_slug?: string | null
          consecutive_failures?: number
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          kind?: string
          last_fetched_at?: string | null
          last_success_at?: string | null
          name: string
          notes?: string | null
          publisher: string
          url: string
        }
        Update: {
          category?: string
          company_id?: string | null
          company_slug?: string | null
          consecutive_failures?: number
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          kind?: string
          last_fetched_at?: string | null
          last_success_at?: string | null
          name?: string
          notes?: string | null
          publisher?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_sources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_state: {
        Row: {
          last_job_alert_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          last_job_alert_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          last_job_alert_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          aggregate_count: number
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload: Json
          push_state: string
          pushed_at: string | null
          read_at: string | null
          subject_id: string | null
          subject_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          aggregate_count?: number
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          push_state?: string
          pushed_at?: string | null
          read_at?: string | null
          subject_id?: string | null
          subject_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          aggregate_count?: number
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          push_state?: string
          pushed_at?: string | null
          read_at?: string | null
          subject_id?: string | null
          subject_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pii_access_log: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          detail: string | null
          id: number
          purpose: Database["public"]["Enums"]["pii_purpose"]
          resource: Database["public"]["Enums"]["pii_resource"]
          resource_id: string | null
          subject_user_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          created_at?: string
          detail?: string | null
          id?: never
          purpose: Database["public"]["Enums"]["pii_purpose"]
          resource: Database["public"]["Enums"]["pii_resource"]
          resource_id?: string | null
          subject_user_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          detail?: string | null
          id?: never
          purpose?: Database["public"]["Enums"]["pii_purpose"]
          resource?: Database["public"]["Enums"]["pii_resource"]
          resource_id?: string | null
          subject_user_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          bank_cap: number
          daily_grant: number
          id: string
          long_streak_bonus: number
          long_streak_weeks: number
          max_weekly_bonus: number
          notes: string | null
          rank: number
          resume_limit: number
          streak_bonus: number
        }
        Insert: {
          bank_cap: number
          daily_grant: number
          id: string
          long_streak_bonus: number
          long_streak_weeks: number
          max_weekly_bonus: number
          notes?: string | null
          rank: number
          resume_limit: number
          streak_bonus: number
        }
        Update: {
          bank_cap?: number
          daily_grant?: number
          id?: string
          long_streak_bonus?: number
          long_streak_weeks?: number
          max_weekly_bonus?: number
          notes?: string | null
          rank?: number
          resume_limit?: number
          streak_bonus?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_color: string
          comment_badge: string | null
          content_policy_accepted_at: string | null
          content_policy_version: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          first_name: string | null
          graduation_year: number | null
          handle: string | null
          id: string
          last_name: string | null
          location: string | null
          major: string | null
          onboarding_completed_at: string | null
          school_id: string | null
          school_name_raw: string | null
          updated_at: string
          verification_tier: Database["public"]["Enums"]["verification_tier"]
        }
        Insert: {
          avatar_color?: string
          comment_badge?: string | null
          content_policy_accepted_at?: string | null
          content_policy_version?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          first_name?: string | null
          graduation_year?: number | null
          handle?: string | null
          id: string
          last_name?: string | null
          location?: string | null
          major?: string | null
          onboarding_completed_at?: string | null
          school_id?: string | null
          school_name_raw?: string | null
          updated_at?: string
          verification_tier?: Database["public"]["Enums"]["verification_tier"]
        }
        Update: {
          avatar_color?: string
          comment_badge?: string | null
          content_policy_accepted_at?: string | null
          content_policy_version?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          first_name?: string | null
          graduation_year?: number | null
          handle?: string | null
          id?: string
          last_name?: string | null
          location?: string | null
          major?: string | null
          onboarding_completed_at?: string | null
          school_id?: string | null
          school_name_raw?: string | null
          updated_at?: string
          verification_tier?: Database["public"]["Enums"]["verification_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      push_deliveries: {
        Row: {
          created_at: string
          error: string | null
          id: number
          notification_id: string | null
          receipt_checked_at: string | null
          receipt_error: string | null
          receipt_status: string | null
          status: string
          ticket_id: string | null
          token_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: never
          notification_id?: string | null
          receipt_checked_at?: string | null
          receipt_error?: string | null
          receipt_status?: string | null
          status: string
          ticket_id?: string | null
          token_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: never
          notification_id?: string | null
          receipt_checked_at?: string | null
          receipt_error?: string | null
          receipt_status?: string | null
          status?: string
          ticket_id?: string | null
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_deliveries_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "push_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ranking_weights: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          weights: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          weights: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          weights?: Json
        }
        Relationships: []
      }
      raw_postings: {
        Row: {
          content_hash: string
          external_id: string
          fetched_at: string
          id: number
          payload: Json
          process_error: string | null
          processed_at: string | null
          run_id: string | null
          source_id: string
        }
        Insert: {
          content_hash: string
          external_id: string
          fetched_at?: string
          id?: never
          payload: Json
          process_error?: string | null
          processed_at?: string | null
          run_id?: string | null
          source_id: string
        }
        Update: {
          content_hash?: string
          external_id?: string
          fetched_at?: string
          id?: never
          payload?: Json
          process_error?: string | null
          processed_at?: string | null
          run_id?: string | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_postings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crawl_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_postings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          reason: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          reason: string
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_profiles: {
        Row: {
          confirmed_fields: string[]
          education: Json
          email_enc: string | null
          embedding: string | null
          experience: Json
          full_name_enc: string | null
          location: string | null
          parsed_at: string
          parser_version: string
          phone_enc: string | null
          raw_parse: Json | null
          resume_id: string
          seniority: Database["public"]["Enums"]["seniority_level"] | null
          skills: string[]
          user_confirmed_at: string | null
          years_experience: number | null
        }
        Insert: {
          confirmed_fields?: string[]
          education?: Json
          email_enc?: string | null
          embedding?: string | null
          experience?: Json
          full_name_enc?: string | null
          location?: string | null
          parsed_at?: string
          parser_version: string
          phone_enc?: string | null
          raw_parse?: Json | null
          resume_id: string
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          skills?: string[]
          user_confirmed_at?: string | null
          years_experience?: number | null
        }
        Update: {
          confirmed_fields?: string[]
          education?: Json
          email_enc?: string | null
          embedding?: string | null
          experience?: Json
          full_name_enc?: string | null
          location?: string | null
          parsed_at?: string
          parser_version?: string
          phone_enc?: string | null
          raw_parse?: Json | null
          resume_id?: string
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          skills?: string[]
          user_confirmed_at?: string | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "resume_profiles_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: true
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resumes: {
        Row: {
          content_hash: string | null
          created_at: string
          deleted_at: string | null
          file_size: number | null
          focus: string | null
          id: string
          is_default: boolean
          name: string
          page_count: number | null
          parse_error: string | null
          parse_status: Database["public"]["Enums"]["resume_parse_status"]
          storage_path: string
          thumbnail_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          file_size?: number | null
          focus?: string | null
          id?: string
          is_default?: boolean
          name: string
          page_count?: number | null
          parse_error?: string | null
          parse_status?: Database["public"]["Enums"]["resume_parse_status"]
          storage_path: string
          thumbnail_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          file_size?: number | null
          focus?: string | null
          id?: string
          is_default?: boolean
          name?: string
          page_count?: number | null
          parse_error?: string | null
          parse_status?: Database["public"]["Enums"]["resume_parse_status"]
          storage_path?: string
          thumbnail_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resumes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          country: string
          created_at: string
          email_domains: string[]
          id: string
          name: string
          short_name: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          email_domains?: string[]
          id?: string
          name: string
          short_name?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          email_domains?: string[]
          id?: string
          name?: string
          short_name?: string | null
        }
        Relationships: []
      }
      skills: {
        Row: {
          aliases: string[]
          category: string | null
          created_at: string
          id: string
          label: string
          slug: string
        }
        Insert: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: string
          label: string
          slug: string
        }
        Update: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: string
          label?: string
          slug?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          auto_renew: boolean | null
          environment: string
          last_event_at: string
          original_transaction_id: string
          period_end: string | null
          product_id: string
          provider: string
          revenuecat_id: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_renew?: boolean | null
          environment?: string
          last_event_at: string
          original_transaction_id: string
          period_end?: string | null
          product_id: string
          provider: string
          revenuecat_id?: string | null
          status: string
          tier: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_renew?: boolean | null
          environment?: string
          last_event_at?: string
          original_transaction_id?: string
          period_end?: string | null
          product_id?: string
          provider?: string
          revenuecat_id?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_tier_fkey"
            columns: ["tier"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_accounts: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          min_salary_annual: number | null
          notification_prefs: Json
          open_to_remote: boolean
          preferred_employment_types: Database["public"]["Enums"]["employment_type"][]
          preferred_industries: string[]
          preferred_locations: string[]
          preferred_roles: string[]
          updated_at: string
          user_id: string
          weekly_goal: number
        }
        Insert: {
          min_salary_annual?: number | null
          notification_prefs?: Json
          open_to_remote?: boolean
          preferred_employment_types?: Database["public"]["Enums"]["employment_type"][]
          preferred_industries?: string[]
          preferred_locations?: string[]
          preferred_roles?: string[]
          updated_at?: string
          user_id: string
          weekly_goal?: number
        }
        Update: {
          min_salary_annual?: number | null
          notification_prefs?: Json
          open_to_remote?: boolean
          preferred_employment_types?: Database["public"]["Enums"]["employment_type"][]
          preferred_industries?: string[]
          preferred_locations?: string[]
          preferred_roles?: string[]
          updated_at?: string
          user_id?: string
          weekly_goal?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_strikes: {
        Row: {
          comment_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          issued_by: string | null
          reason: string
          severity: number
          user_id: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          reason: string
          severity: number
          user_id: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          reason?: string
          severity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_strikes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_strikes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_strikes_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_strikes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_taste_vectors: {
        Row: {
          computed_at: string
          embedding: string
          signal_count: number
          user_id: string
        }
        Insert: {
          computed_at?: string
          embedding: string
          signal_count?: number
          user_id: string
        }
        Update: {
          computed_at?: string
          embedding?: string
          signal_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_taste_vectors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_blocklist: {
        Row: {
          created_at: string
          identifier_hash: string
          kind: Database["public"]["Enums"]["verification_kind"]
          reason: string
        }
        Insert: {
          created_at?: string
          identifier_hash: string
          kind: Database["public"]["Enums"]["verification_kind"]
          reason: string
        }
        Update: {
          created_at?: string
          identifier_hash?: string
          kind?: Database["public"]["Enums"]["verification_kind"]
          reason?: string
        }
        Relationships: []
      }
      verifications: {
        Row: {
          attempts: number
          created_at: string
          edu_domain: string | null
          edu_email: string | null
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["verification_kind"]
          provider: string | null
          provider_ref: string | null
          provider_result: Json | null
          school_id: string | null
          status: Database["public"]["Enums"]["verification_status"]
          token_expires_at: string | null
          token_hash: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          edu_domain?: string | null
          edu_email?: string | null
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["verification_kind"]
          provider?: string | null
          provider_ref?: string | null
          provider_result?: Json | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          edu_domain?: string | null
          edu_email?: string | null
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["verification_kind"]
          provider?: string | null
          provider_ref?: string | null
          provider_result?: Json | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verifications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      comments_public: {
        Row: {
          author_badge: string | null
          author_color: string | null
          author_handle: string | null
          body: string | null
          created_at: string | null
          edited_at: string | null
          gif_id: string | null
          id: string | null
          job_id: string | null
          like_count: number | null
          parent_id: string | null
          reply_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments_public"
            referencedColumns: ["id"]
          },
        ]
      }
      job_cards: {
        Row: {
          apply_host: string | null
          apply_url: string | null
          closes_at: string | null
          company_id: string | null
          company_logo_color: string | null
          company_logo_url: string | null
          company_monogram: string | null
          company_name: string | null
          company_slug: string | null
          dedup_group_id: string | null
          description_text: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          id: string | null
          last_seen_at: string | null
          location_city: string | null
          location_country: string | null
          location_raw: string | null
          location_region: string | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          posted_at: string | null
          quality_score: number | null
          requirements: string[] | null
          salary_annual_max: number | null
          salary_is_estimated: boolean | null
          salary_max: number | null
          salary_min: number | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          search_vector: unknown
          seniority: Database["public"]["Enums"]["seniority_level"] | null
          skills: string[] | null
          status: Database["public"]["Enums"]["job_status"] | null
          title: string | null
          title_normalized: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications_public: {
        Row: {
          aggregate_count: number | null
          created_at: string | null
          id: string | null
          kind: Database["public"]["Enums"]["notification_kind"] | null
          payload: Json | null
          read_at: string | null
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          aggregate_count?: number | null
          created_at?: string | null
          id?: string | null
          kind?: Database["public"]["Enums"]["notification_kind"] | null
          payload?: Json | null
          read_at?: string | null
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          aggregate_count?: number | null
          created_at?: string | null
          id?: string | null
          kind?: Database["public"]["Enums"]["notification_kind"] | null
          payload?: Json | null
          read_at?: string | null
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      abandon_auto_apply: { Args: { p_run_id: string }; Returns: boolean }
      accept_content_policy: { Args: { p_version: string }; Returns: string }
      active_weights: { Args: never; Returns: Json }
      applications_in_week: {
        Args: { p_user_id: string; p_week_start: string }
        Returns: number
      }
      apply_revenuecat_event: { Args: { p_event: Json }; Returns: string }
      apply_strike: {
        Args: {
          p_comment_id?: string
          p_issued_by?: string
          p_reason: string
          p_severity?: number
          p_user_id: string
        }
        Returns: {
          expires_at: string
          severity: number
          strike_id: string
        }[]
      }
      begin_account_purge: {
        Args: { p_force?: boolean; p_user_id: string }
        Returns: {
          bucket: string
          path: string
        }[]
      }
      build_feed_session: {
        Args: {
          p_experiment?: string
          p_size?: number
          p_surface?: Database["public"]["Enums"]["feed_surface"]
          p_user_id: string
        }
        Returns: string
      }
      cancel_account_deletion: { Args: never; Returns: boolean }
      candidate_pool: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          job_id: string
          source: string
        }[]
      }
      claim_daily_grant: {
        Args: { p_created_at: string; p_user_id: string }
        Returns: number
      }
      claim_digest_batch: {
        Args: { p_limit?: number; p_week_start: string }
        Returns: Database["public"]["CompositeTypes"]["digest_job"][]
        SetofOptions: {
          from: "*"
          to: "digest_job"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_push_batch: {
        Args: { p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["push_job"][]
        SetofOptions: {
          from: "*"
          to: "push_job"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_streak_bonus: {
        Args: { p_week_start: string }
        Returns: Database["public"]["CompositeTypes"]["streak_award"]
        SetofOptions: {
          from: "*"
          to: "streak_award"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_stale_jobs: { Args: { p_unseen_hours?: number }; Returns: number }
      comment_card_of: {
        Args: { p_comment_id: string; p_viewer: string }
        Returns: Database["public"]["CompositeTypes"]["comment_card"]
        SetofOptions: {
          from: "*"
          to: "comment_card"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      comment_counts: {
        Args: { p_job_ids: string[] }
        Returns: {
          comment_count: number
          job_id: string
        }[]
      }
      comment_gate: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["comment_gate_state"]
        SetofOptions: {
          from: "*"
          to: "comment_gate_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      comment_replies: {
        Args: { p_comment_id: string; p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["comment_card"][]
        SetofOptions: {
          from: "*"
          to: "comment_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_account_purge: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      complete_auto_apply: {
        Args: { p_applied_on?: string; p_run_id: string }
        Returns: string
      }
      compute_match: {
        Args: {
          p_job_city: string
          p_job_region: string
          p_job_seniority: Database["public"]["Enums"]["seniority_level"]
          p_job_skills: string[]
          p_job_type: Database["public"]["Enums"]["location_type"]
          p_preferred_locs: string[]
          p_remote_ok: boolean
          p_resume_seniority: Database["public"]["Enums"]["seniority_level"]
          p_resume_skills: string[]
        }
        Returns: Json
      }
      confirm_edu_verification: {
        Args: { p_token_hash: string; p_user_id: string }
        Returns: {
          badge: string
          school_name: string
          verification_id: string
        }[]
      }
      confirm_resume_profile: {
        Args: {
          p_location?: string
          p_resume_id: string
          p_seniority?: Database["public"]["Enums"]["seniority_level"]
          p_skills?: string[]
          p_years?: number
        }
        Returns: Database["public"]["CompositeTypes"]["resume_card"]
        SetofOptions: {
          from: "*"
          to: "resume_card"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      credit_balance: { Args: { p_user_id: string }; Returns: number }
      decode_cursor: { Args: { p_cursor: string }; Returns: Json }
      delete_own_comment: { Args: { p_comment_id: string }; Returns: boolean }
      delete_resume: { Args: { p_resume_id: string }; Returns: boolean }
      drop_old_impression_partitions: {
        Args: { p_keep_months?: number }
        Returns: number
      }
      due_account_purges: { Args: { p_limit?: number }; Returns: string[] }
      encode_cursor: {
        Args: { p_id: string; p_value: string }
        Returns: string
      }
      ensure_impression_partitions: {
        Args: { p_months_ahead?: number }
        Returns: number
      }
      experiment_arm: {
        Args: { p_experiment: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["feed_arm"]
      }
      expire_auto_apply_runs: {
        Args: { p_ready_days?: number; p_stuck_minutes?: number }
        Returns: number
      }
      expire_edu_verifications: {
        Args: { p_grace_days?: number }
        Returns: number
      }
      explain_feed_rank: { Args: { p_job_id: string }; Returns: Json }
      export_account: { Args: { p_user_id: string }; Returns: Json }
      fail_auto_apply: {
        Args: {
          p_cost_usd?: number
          p_model?: string
          p_reason: string
          p_run_id: string
          p_tokens_in?: number
          p_tokens_out?: number
        }
        Returns: undefined
      }
      feed_experiment_results: {
        Args: { p_experiment?: string; p_since?: string }
        Returns: {
          applications: number
          apply_rate: number
          arm: Database["public"]["Enums"]["feed_arm"]
          contaminated: number
          impressions: number
          lift_pct: number
          save_rate: number
          saves: number
          sessions: number
          users: number
        }[]
      }
      feed_jobs: {
        Args: {
          p_company_slugs?: string[]
          p_cursor?: string
          p_limit?: number
          p_min_quality?: number
          p_sort?: string
        }
        Returns: Database["public"]["CompositeTypes"]["job_card"][]
        SetofOptions: {
          from: "*"
          to: "job_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      generate_deadline_reminders: {
        Args: { p_within_days?: number }
        Returns: number
      }
      generate_handle: { Args: never; Returns: string }
      generate_job_alerts: { Args: { p_max_users?: number }; Returns: number }
      grant_period_at: {
        Args: { p_at: string; p_created_at: string }
        Returns: number
      }
      ingest_upsert_job: { Args: { p: Json }; Returns: string }
      ingest_upsert_jobs: { Args: { p_rows: Json }; Returns: Json }
      invalidate_match_scores: { Args: { p_user_id: string }; Returns: number }
      is_moderator: { Args: { p_user_id: string }; Returns: boolean }
      job_comments: {
        Args: { p_cursor?: string; p_job_id: string; p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["comment_card"][]
        SetofOptions: {
          from: "*"
          to: "comment_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      job_dedup_key: {
        Args: {
          p_company_id: string
          p_location_city: string
          p_seniority: Database["public"]["Enums"]["seniority_level"]
          p_title_normalized: string
        }
        Returns: string
      }
      location_affinity: {
        Args: {
          p_city: string
          p_preferred: string[]
          p_region: string
          p_remote_ok: boolean
          p_type: Database["public"]["Enums"]["location_type"]
        }
        Returns: number
      }
      lock_ledger: { Args: { p_user_id: string }; Returns: string }
      log_impressions: { Args: { p_rows: Json }; Returns: number }
      log_pii_access: {
        Args: {
          p_actor_id: string
          p_actor_type: string
          p_detail?: string
          p_purpose: Database["public"]["Enums"]["pii_purpose"]
          p_resource: Database["public"]["Enums"]["pii_resource"]
          p_resource_id: string
          p_subject: string
        }
        Returns: number
      }
      mark_news_seen: { Args: { p_ids: string[] }; Returns: number }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: number }
      match_scores: {
        Args: { p_job_ids: string[] }
        Returns: {
          components: Json
          computed_at: string
          job_id: string
          score: number
        }[]
      }
      moderation_queue: {
        Args: { p_limit?: number }
        Returns: {
          author_badge: string
          author_handle: string
          author_id: string
          author_tier: Database["public"]["Enums"]["verification_tier"]
          body: string
          comment_id: string
          created_at: string
          details: string[]
          gif_id: string
          job_id: string
          kind: string
          moderation_reason: string
          moderation_scores: Json
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          prior_strikes: number
          reasons: string[]
          report_count: number
          report_id: string
        }[]
      }
      moderation_resolve: {
        Args: {
          p_comment_id: string
          p_moderator?: string
          p_reason: string
          p_severity?: number
          p_status: Database["public"]["Enums"]["moderation_status"]
          p_strike?: boolean
        }
        Returns: {
          comment_id: string
          status: Database["public"]["Enums"]["moderation_status"]
          strike_severity: number
        }[]
      }
      my_account_status: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["account_status"]
        SetofOptions: {
          from: "*"
          to: "account_status"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_credits: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["credit_summary"]
        SetofOptions: {
          from: "*"
          to: "credit_summary"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_resumes: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["resume_card"][]
        SetofOptions: {
          from: "*"
          to: "resume_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      news_feed: {
        Args: { p_days?: number; p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["news_card"][]
        SetofOptions: {
          from: "*"
          to: "news_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      notification_pref: {
        Args: { p_channel: string; p_key: string; p_prefs: Json }
        Returns: boolean
      }
      notify_moderation: {
        Args: {
          p_detail?: string
          p_headline: string
          p_kind?: Database["public"]["Enums"]["notification_kind"]
          p_subject_id?: string
          p_user_id: string
        }
        Returns: string
      }
      owned_run: {
        Args: { p_run_id: string }
        Returns: {
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          draft: Json | null
          edited_fields: string[] | null
          error: string | null
          form: Json | null
          form_source: string | null
          id: string
          job_id: string
          model: string | null
          prompt_version: string | null
          resume_id: string
          reviewed_at: string | null
          status: Database["public"]["Enums"]["auto_apply_status"]
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "auto_apply_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      post_comment: {
        Args: {
          p_author_id: string
          p_body: string
          p_gif_id?: string
          p_idempotency_key?: string
          p_job_id: string
          p_parent_id?: string
          p_reason?: string
          p_scores?: Json
          p_status?: Database["public"]["Enums"]["moderation_status"]
        }
        Returns: Database["public"]["CompositeTypes"]["comment_card"]
        SetofOptions: {
          from: "*"
          to: "comment_card"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pref_match: {
        Args: {
          p_city: string
          p_locs: string[]
          p_region: string
          p_remote: boolean
          p_roles: string[]
          p_title_normalized: string
          p_type: Database["public"]["Enums"]["location_type"]
        }
        Returns: number
      }
      prune_deleted_resumes: {
        Args: { p_grace_days?: number }
        Returns: {
          resume_id: string
          storage_path: string
        }[]
      }
      prune_feed_sessions: { Args: { p_keep_hours?: number }; Returns: number }
      prune_match_scores: { Args: { p_keep_days?: number }; Returns: number }
      prune_notifications: { Args: { p_keep_days?: number }; Returns: number }
      prune_pii_access_log: { Args: { p_keep_days?: number }; Returns: number }
      prune_push_deliveries: { Args: { p_keep_days?: number }; Returns: number }
      push_pref_key: {
        Args: { p_kind: Database["public"]["Enums"]["notification_kind"] }
        Returns: string
      }
      push_receipts_due: {
        Args: { p_limit?: number }
        Returns: {
          delivery_id: number
          ticket_id: string
          token_id: string
        }[]
      }
      rank_score: {
        Args: {
          p_affinity: number
          p_cohort: number
          p_popularity: number
          p_pref: number
          p_quality: number
          p_recency: number
          p_seen_count: number
          p_skill: number
          p_urgency: number
          p_weights: Json
        }
        Returns: Json
      }
      ranked_feed: {
        Args: {
          p_cursor?: string
          p_limit?: number
          p_surface?: Database["public"]["Enums"]["feed_surface"]
        }
        Returns: Database["public"]["CompositeTypes"]["job_card"][]
        SetofOptions: {
          from: "*"
          to: "job_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      recency_score: { Args: { p_posted_at: string }; Returns: number }
      reconcile_comment_counts: { Args: never; Returns: number }
      reconcile_follower_counts: { Args: never; Returns: number }
      record_digest_result: {
        Args: {
          p_error?: string
          p_provider_id?: string
          p_status: string
          p_user_id: string
          p_week_start: string
        }
        Returns: undefined
      }
      record_export_size: {
        Args: { p_bytes: number; p_user_id: string }
        Returns: undefined
      }
      record_identity_verification: {
        Args: {
          p_identifier_hash?: string
          p_passed: boolean
          p_provider: string
          p_provider_ref: string
          p_result?: Json
          p_user_id: string
        }
        Returns: Database["public"]["Enums"]["verification_tier"]
      }
      record_push_receipts: { Args: { p_receipts: Json }; Returns: number }
      record_push_results: { Args: { p_results: Json }; Returns: number }
      refresh_open_job_counts: { Args: never; Returns: number }
      refund_auto_apply: {
        Args: { p_run: Database["public"]["Tables"]["auto_apply_runs"]["Row"] }
        Returns: undefined
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: string
      }
      register_resume: {
        Args: {
          p_content_hash?: string
          p_file_size?: number
          p_focus?: string
          p_name: string
          p_storage_path: string
        }
        Returns: Database["public"]["CompositeTypes"]["resume_card"]
        SetofOptions: {
          from: "*"
          to: "resume_card"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_content: {
        Args: {
          p_comment_id: string
          p_detail?: string
          p_reason: string
          p_target?: Database["public"]["Enums"]["report_target"]
        }
        Returns: string
      }
      request_account_deletion: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["account_status"]
        SetofOptions: {
          from: "*"
          to: "account_status"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_report: {
        Args: {
          p_moderator?: string
          p_report_id: string
          p_status: Database["public"]["Enums"]["report_status"]
        }
        Returns: boolean
      }
      resume_by_content_hash: {
        Args: { p_content_hash: string }
        Returns: Database["public"]["CompositeTypes"]["resume_card"]
        SetofOptions: {
          from: "*"
          to: "resume_card"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resume_for_service: {
        Args: { p_resume_id: string }
        Returns: {
          content_hash: string
          parse_status: Database["public"]["Enums"]["resume_parse_status"]
          resume_id: string
          storage_path: string
          user_id: string
        }[]
      }
      review_auto_apply: {
        Args: { p_edited?: string[]; p_run_id: string; p_seen: string[] }
        Returns: Database["public"]["Enums"]["auto_apply_status"]
      }
      save_auto_apply_draft: {
        Args: {
          p_cost_usd: number
          p_draft: Json
          p_form: Json
          p_form_source: string
          p_model: string
          p_prompt_version: string
          p_run_id: string
          p_tokens_in: number
          p_tokens_out: number
        }
        Returns: Database["public"]["Enums"]["auto_apply_status"]
      }
      save_resume_profile: {
        Args: {
          p_education?: Json
          p_email_enc?: string
          p_experience?: Json
          p_full_name_enc?: string
          p_location?: string
          p_page_count?: number
          p_parser_version: string
          p_phone_enc?: string
          p_raw_parse?: Json
          p_resume_id: string
          p_seniority?: Database["public"]["Enums"]["seniority_level"]
          p_skills?: string[]
          p_years?: number
        }
        Returns: string
      }
      search_companies: {
        Args: { p_limit?: number; p_query: string }
        Returns: Database["public"]["CompositeTypes"]["company_card"][]
        SetofOptions: {
          from: "*"
          to: "company_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_jobs: {
        Args: {
          p_cursor?: string
          p_limit?: number
          p_min_quality?: number
          p_query: string
        }
        Returns: Database["public"]["CompositeTypes"]["job_card"][]
        SetofOptions: {
          from: "*"
          to: "job_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      seniority_affinity: {
        Args: {
          p_job: Database["public"]["Enums"]["seniority_level"]
          p_resume: Database["public"]["Enums"]["seniority_level"]
        }
        Returns: number
      }
      set_block_from_comment: {
        Args: { p_comment_id: string; p_on: boolean }
        Returns: boolean
      }
      set_claimed_school: {
        Args: { p_ipeds_id: number | null }
        Returns: string | null
      }
      set_comment_like: {
        Args: { p_comment_id: string; p_on: boolean }
        Returns: boolean
      }
      set_company_follow: {
        Args: { p_company_slug: string; p_on: boolean }
        Returns: boolean
      }
      set_default_resume: { Args: { p_resume_id: string }; Returns: boolean }
      set_job_interaction: {
        Args: {
          p_job_id: string
          p_kind: Database["public"]["Enums"]["interaction_kind"]
          p_on: boolean
        }
        Returns: boolean
      }
      set_notification_pref: {
        Args: {
          p_channel: string
          p_key: string
          p_user_id: string
          p_value: boolean
        }
        Returns: Json
      }
      set_parse_status: {
        Args: {
          p_error?: string
          p_resume_id: string
          p_status: Database["public"]["Enums"]["resume_parse_status"]
        }
        Returns: boolean
      }
      skill_jaccard: {
        Args: { p_left: string[]; p_right: string[] }
        Returns: number
      }
      start_auto_apply: {
        Args: { p_job_id: string; p_resume_id?: string; p_user_id: string }
        Returns: Database["public"]["CompositeTypes"]["auto_apply_start"]
        SetofOptions: {
          from: "*"
          to: "auto_apply_start"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_edu_verification: {
        Args: {
          p_email: string
          p_identifier_hash: string
          p_token_hash: string
          p_ttl_minutes?: number
          p_user_id: string
        }
        Returns: {
          school_id: string
          school_name: string
          verification_id: string
        }[]
      }
      suggested_companies: {
        Args: { p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["company_card"][]
        SetofOptions: {
          from: "*"
          to: "company_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      text_array_to_string: {
        Args: { p_sep: string; p_values: string[] }
        Returns: string
      }
      unregister_push_token: { Args: { p_token: string }; Returns: boolean }
      urgency_score: { Args: { p_closes_at: string }; Returns: number }
      viewer_plan: {
        Args: { p_user_id: string }
        Returns: {
          bank_cap: number
          daily_grant: number
          id: string
          long_streak_bonus: number
          long_streak_weeks: number
          max_weekly_bonus: number
          notes: string | null
          rank: number
          resume_limit: number
          streak_bonus: number
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      viewer_state: {
        Args: { p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["viewer_sets"]
        SetofOptions: {
          from: "*"
          to: "viewer_sets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      application_source:
        | "greenhouse"
        | "workday"
        | "lever"
        | "ashby"
        | "company"
      application_status: "applied" | "interview" | "offer" | "closed"
      ats_kind:
        | "greenhouse"
        | "lever"
        | "ashby"
        | "workday"
        | "smartrecruiters"
        | "company_site"
        | "feed"
      auto_apply_status:
        | "pending"
        | "ready"
        | "reviewed"
        | "used"
        | "abandoned"
        | "failed"
      credit_kind:
        | "daily_grant"
        | "streak_bonus"
        | "spend"
        | "refund"
        | "purchase"
        | "subscription_grant"
        | "adjustment"
      employment_type: "Internship" | "Full-time" | "Part-time" | "Contract"
      feed_arm: "ranked" | "recency"
      feed_surface:
        | "reels"
        | "home"
        | "search"
        | "company"
        | "collection"
        | "story"
      interaction_kind: "like" | "save" | "hide" | "not_interested"
      job_status: "open" | "closed" | "expired" | "removed" | "suppressed"
      location_type: "Onsite" | "Hybrid" | "Remote"
      moderation_status: "pending" | "approved" | "flagged" | "removed"
      notification_kind:
        | "comment_reply"
        | "comment_like"
        | "moderation"
        | "verification"
        | "job_alert"
        | "deadline"
      pii_purpose:
        | "parse"
        | "match"
        | "user_download"
        | "autoapply"
        | "support"
        | "export"
      pii_resource: "resume_pdf" | "resume_profile"
      report_status: "open" | "actioned" | "dismissed"
      report_target: "comment" | "profile"
      resume_parse_status: "pending" | "parsing" | "parsed" | "failed"
      salary_period: "hour" | "year"
      seniority_level: "intern" | "new_grad" | "mid" | "senior" | "staff_plus"
      verification_kind: "edu_email" | "government_id"
      verification_status: "pending" | "verified" | "failed" | "expired"
      verification_tier: "none" | "email" | "edu" | "identity"
    }
    CompositeTypes: {
      account_status: {
        deletion_requested_at: string | null
        purge_after: string | null
      }
      auto_apply_start: {
        run_id: string | null
        status: Database["public"]["Enums"]["auto_apply_status"] | null
        charged: boolean | null
        balance: number | null
      }
      comment_card: {
        id: string | null
        job_id: string | null
        parent_id: string | null
        body: string | null
        gif_id: string | null
        like_count: number | null
        reply_count: number | null
        created_at: string | null
        edited_at: string | null
        author_handle: string | null
        author_badge: string | null
        author_color: string | null
        is_own: boolean | null
        page_cursor: string | null
      }
      comment_gate_state: {
        can_comment: boolean | null
        tier: Database["public"]["Enums"]["verification_tier"] | null
        handle: string | null
        badge: string | null
        policy_version: string | null
        policy_accepted: boolean | null
        muted_until: string | null
        banned: boolean | null
        remaining_hour: number | null
        remaining_day: number | null
      }
      company_card: {
        id: string | null
        slug: string | null
        name: string | null
        domain: string | null
        logo_url: string | null
        logo_monogram: string | null
        logo_color: string | null
        industry: string | null
        hq_location: string | null
        description: string | null
        follower_count: number | null
        open_job_count: number | null
        rank: number | null
      }
      credit_summary: {
        balance: number | null
        plan: string | null
        daily_grant: number | null
        bank_cap: number | null
        resume_limit: number | null
        next_grant_at: string | null
        granted_now: number | null
      }
      digest_job: {
        user_id: string | null
        email: string | null
        first_name: string | null
        content: Json | null
      }
      job_card: {
        id: string | null
        company_id: string | null
        company_slug: string | null
        company_name: string | null
        company_logo_url: string | null
        company_logo_color: string | null
        company_monogram: string | null
        title: string | null
        seniority: Database["public"]["Enums"]["seniority_level"] | null
        location_raw: string | null
        location_city: string | null
        location_region: string | null
        location_country: string | null
        location_type: Database["public"]["Enums"]["location_type"] | null
        employment_type: Database["public"]["Enums"]["employment_type"] | null
        salary_min: number | null
        salary_max: number | null
        salary_period: Database["public"]["Enums"]["salary_period"] | null
        salary_is_estimated: boolean | null
        description_text: string | null
        requirements: string[] | null
        skills: string[] | null
        apply_url: string | null
        apply_host: string | null
        posted_at: string | null
        last_seen_at: string | null
        closes_at: string | null
        quality_score: number | null
        dedup_group_id: string | null
        page_cursor: string | null
        rank: number | null
      }
      news_card: {
        id: string | null
        category: string | null
        company_slug: string | null
        company_name: string | null
        url: string | null
        publisher: string | null
        tag: string | null
        headline: string | null
        subtext: string | null
        summary: string[] | null
        topic: string | null
        accent_color: string | null
        published_at: string | null
        seen: boolean | null
      }
      push_job: {
        notification_id: string | null
        user_id: string | null
        kind: Database["public"]["Enums"]["notification_kind"] | null
        subject_type: string | null
        subject_id: string | null
        payload: Json | null
        token_ids: string[] | null
        tokens: string[] | null
      }
      resume_card: {
        id: string | null
        name: string | null
        focus: string | null
        file_size: number | null
        page_count: number | null
        is_default: boolean | null
        parse_status: Database["public"]["Enums"]["resume_parse_status"] | null
        parse_error: string | null
        skills: string[] | null
        education: Json | null
        experience: Json | null
        years_experience: number | null
        location: string | null
        seniority: Database["public"]["Enums"]["seniority_level"] | null
        parsed_at: string | null
        user_confirmed_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      streak_award: {
        week_start: string | null
        awarded: number | null
        earned: number | null
        streak_weeks: number | null
        outcome: string | null
      }
      viewer_sets: {
        liked_job_ids: string[] | null
        saved_job_ids: string[] | null
        hidden_job_ids: string[] | null
        followed_company_ids: string[] | null
        followed_company_slugs: string[] | null
        liked_comment_ids: string[] | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_source: [
        "greenhouse",
        "workday",
        "lever",
        "ashby",
        "company",
      ],
      application_status: ["applied", "interview", "offer", "closed"],
      ats_kind: [
        "greenhouse",
        "lever",
        "ashby",
        "workday",
        "smartrecruiters",
        "company_site",
        "feed",
      ],
      auto_apply_status: [
        "pending",
        "ready",
        "reviewed",
        "used",
        "abandoned",
        "failed",
      ],
      credit_kind: [
        "daily_grant",
        "streak_bonus",
        "spend",
        "refund",
        "purchase",
        "subscription_grant",
        "adjustment",
      ],
      employment_type: ["Internship", "Full-time", "Part-time", "Contract"],
      feed_arm: ["ranked", "recency"],
      feed_surface: [
        "reels",
        "home",
        "search",
        "company",
        "collection",
        "story",
      ],
      interaction_kind: ["like", "save", "hide", "not_interested"],
      job_status: ["open", "closed", "expired", "removed", "suppressed"],
      location_type: ["Onsite", "Hybrid", "Remote"],
      moderation_status: ["pending", "approved", "flagged", "removed"],
      notification_kind: [
        "comment_reply",
        "comment_like",
        "moderation",
        "verification",
        "job_alert",
        "deadline",
      ],
      pii_purpose: [
        "parse",
        "match",
        "user_download",
        "autoapply",
        "support",
        "export",
      ],
      pii_resource: ["resume_pdf", "resume_profile"],
      report_status: ["open", "actioned", "dismissed"],
      report_target: ["comment", "profile"],
      resume_parse_status: ["pending", "parsing", "parsed", "failed"],
      salary_period: ["hour", "year"],
      seniority_level: ["intern", "new_grad", "mid", "senior", "staff_plus"],
      verification_kind: ["edu_email", "government_id"],
      verification_status: ["pending", "verified", "failed", "expired"],
      verification_tier: ["none", "email", "edu", "identity"],
    },
  },
} as const

