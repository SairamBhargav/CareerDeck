// Generated from the local database by `npm run types:generate` — do not edit by hand.
// Regenerate after every migration; the client is typed against this file.
//
// Phase 2's entries were written by hand, because that phase was built without a local
// database to generate from — PHASE2.md §8. Regenerate after the first `npm run db:reset`
// that applies 20260923000000_phase2_interactions.sql; that run is what checks them.

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
      profiles: {
        Row: {
          avatar_color: string
          comment_badge: string | null
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
    }
    Views: {
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
    }
    Functions: {
      close_stale_jobs: { Args: { p_unseen_hours?: number }; Returns: number }
      decode_cursor: { Args: { p_cursor: string }; Returns: Json }
      drop_old_impression_partitions: {
        Args: { p_keep_months?: number }
        Returns: number
      }
      ensure_impression_partitions: {
        Args: { p_months_ahead?: number }
        Returns: number
      }
      encode_cursor: {
        Args: { p_id: string; p_value: string }
        Returns: string
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
      ingest_upsert_job: { Args: { p: Json }; Returns: string }
      ingest_upsert_jobs: { Args: { p_rows: Json }; Returns: Json }
      job_dedup_key: {
        Args: {
          p_company_id: string
          p_location_city: string
          p_seniority: Database["public"]["Enums"]["seniority_level"]
          p_title_normalized: string
        }
        Returns: string
      }
      log_impressions: { Args: { p_rows: Json }; Returns: number }
      reconcile_follower_counts: { Args: never; Returns: number }
      refresh_open_job_counts: { Args: never; Returns: number }
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
      set_company_follow: {
        Args: { p_company_slug: string; p_on: boolean }
        Returns: boolean
      }
      set_job_interaction: {
        Args: {
          p_job_id: string
          p_kind: Database["public"]["Enums"]["interaction_kind"]
          p_on: boolean
        }
        Returns: boolean
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
      viewer_state: {
        Args: { p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["viewer_sets"]
      }
    }
    Enums: {
      application_source: "greenhouse" | "workday" | "lever" | "ashby" | "company"
      application_status: "applied" | "interview" | "offer" | "closed"
      ats_kind:
        | "greenhouse"
        | "lever"
        | "ashby"
        | "workday"
        | "smartrecruiters"
        | "company_site"
        | "feed"
      employment_type: "Internship" | "Full-time" | "Part-time" | "Contract"
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
      salary_period: "hour" | "year"
      seniority_level: "intern" | "new_grad" | "mid" | "senior" | "staff_plus"
      verification_tier: "none" | "email" | "edu" | "identity"
    }
    CompositeTypes: {
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
      viewer_sets: {
        liked_job_ids: string[] | null
        saved_job_ids: string[] | null
        hidden_job_ids: string[] | null
        followed_company_ids: string[] | null
        followed_company_slugs: string[] | null
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
      ats_kind: [
        "greenhouse",
        "lever",
        "ashby",
        "workday",
        "smartrecruiters",
        "company_site",
        "feed",
      ],
      employment_type: ["Internship", "Full-time", "Part-time", "Contract"],
      job_status: ["open", "closed", "expired", "removed", "suppressed"],
      location_type: ["Onsite", "Hybrid", "Remote"],
      salary_period: ["hour", "year"],
      seniority_level: ["intern", "new_grad", "mid", "senior", "staff_plus"],
      verification_tier: ["none", "email", "edu", "identity"],
    },
  },
} as const

