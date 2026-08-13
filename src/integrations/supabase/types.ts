export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_categories: {
        Row: {
          areas: Database["public"]["Enums"]["level_area"][]
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          areas?: Database["public"]["Enums"]["level_area"][]
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          areas?: Database["public"]["Enums"]["level_area"][]
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      activity_time_tracking: {
        Row: {
          actual_end_time: string | null
          actual_start_time: string | null
          budget_item_id: string
          client_id: string | null
          created_at: string
          google_event_id: string | null
          google_event_title: string | null
          id: string
          is_recurring: boolean | null
          notes: string | null
          recurrence_count: number | null
          recurrence_end_date: string | null
          recurrence_parent_id: string | null
          recurrence_type: string | null
          scheduled_date: string | null
          scheduled_end_time: string | null
          scheduled_start_time: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          budget_item_id: string
          client_id?: string | null
          created_at?: string
          google_event_id?: string | null
          google_event_title?: string | null
          id?: string
          is_recurring?: boolean | null
          notes?: string | null
          recurrence_count?: number | null
          recurrence_end_date?: string | null
          recurrence_parent_id?: string | null
          recurrence_type?: string | null
          scheduled_date?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          budget_item_id?: string
          client_id?: string | null
          created_at?: string
          google_event_id?: string | null
          google_event_title?: string | null
          id?: string
          is_recurring?: boolean | null
          notes?: string | null
          recurrence_count?: number | null
          recurrence_end_date?: string | null
          recurrence_parent_id?: string | null
          recurrence_type?: string | null
          scheduled_date?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_time_tracking_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_time_tracking_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_time_tracking_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "activity_time_tracking"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_logs: {
        Row: {
          api_key_id: string | null
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          ip_address: string | null
          latency_ms: number | null
          method: string
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          latency_ms?: number | null
          method: string
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          latency_ms?: number | null
          method?: string
          status_code?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      budget_audit_log: {
        Row: {
          action: string
          budget_id: string
          created_at: string
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          user_id: string
        }
        Insert: {
          action: string
          budget_id: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id: string
        }
        Update: {
          action?: string
          budget_id?: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_audit_log_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_items: {
        Row: {
          activity_name: string
          assignee_id: string | null
          assignee_name: string | null
          budget_id: string | null
          category: string
          client_id: string | null
          created_at: string
          created_from: string | null
          display_order: number
          duration_days: number | null
          hourly_rate: number
          hours_worked: number
          id: string
          is_custom_activity: boolean | null
          is_product: boolean | null
          parent_id: string | null
          payment_terms: string | null
          product_id: string | null
          project_id: string | null
          source_template_id: string | null
          start_day_offset: number | null
          total_cost: number
          updated_at: string
          vat_rate: number
        }
        Insert: {
          activity_name: string
          assignee_id?: string | null
          assignee_name?: string | null
          budget_id?: string | null
          category: string
          client_id?: string | null
          created_at?: string
          created_from?: string | null
          display_order: number
          duration_days?: number | null
          hourly_rate: number
          hours_worked: number
          id?: string
          is_custom_activity?: boolean | null
          is_product?: boolean | null
          parent_id?: string | null
          payment_terms?: string | null
          product_id?: string | null
          project_id?: string | null
          source_template_id?: string | null
          start_day_offset?: number | null
          total_cost: number
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          activity_name?: string
          assignee_id?: string | null
          assignee_name?: string | null
          budget_id?: string | null
          category?: string
          client_id?: string | null
          created_at?: string
          created_from?: string | null
          display_order?: number
          duration_days?: number | null
          hourly_rate?: number
          hours_worked?: number
          id?: string
          is_custom_activity?: boolean | null
          is_product?: boolean | null
          parent_id?: string | null
          payment_terms?: string | null
          product_id?: string | null
          project_id?: string | null
          source_template_id?: string | null
          start_day_offset?: number | null
          total_cost?: number
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "budget_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_items_audit_log: {
        Row: {
          action: string
          budget_id: string | null
          budget_item_id: string
          created_at: string
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          project_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          budget_id?: string | null
          budget_item_id: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          budget_id?: string | null
          budget_item_id?: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      budget_services: {
        Row: {
          budget_id: string
          created_at: string
          id: string
          service_id: string
        }
        Insert: {
          budget_id: string
          created_at?: string
          id?: string
          service_id: string
        }
        Update: {
          budget_id?: string
          created_at?: string
          id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_services_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_templates: {
        Row: {
          created_at: string
          description: string | null
          discipline: Database["public"]["Enums"]["discipline"]
          id: string
          name: string
          template_data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          discipline: Database["public"]["Enums"]["discipline"]
          id?: string
          name: string
          template_data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"]
          id?: string
          name?: string
          template_data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          account_user_id: string | null
          area: string | null
          assigned_user_id: string | null
          brief_link: string | null
          budget_template_id: string | null
          client_contact_id: string | null
          client_id: string | null
          created_at: string
          description: string | null
          discipline: Database["public"]["Enums"]["discipline"] | null
          discount_percentage: number | null
          drive_folder_id: string | null
          drive_folder_name: string | null
          expected_close_date: string | null
          id: string
          margin_percentage: number | null
          name: string
          objective: string | null
          payment_terms: string | null
          project_id: string | null
          project_type: string
          secondary_objective: string | null
          status: Database["public"]["Enums"]["budget_status"]
          status_changed_at: string | null
          total_budget: number | null
          total_hours: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_user_id?: string | null
          area?: string | null
          assigned_user_id?: string | null
          brief_link?: string | null
          budget_template_id?: string | null
          client_contact_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"] | null
          discount_percentage?: number | null
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          expected_close_date?: string | null
          id?: string
          margin_percentage?: number | null
          name: string
          objective?: string | null
          payment_terms?: string | null
          project_id?: string | null
          project_type?: string
          secondary_objective?: string | null
          status?: Database["public"]["Enums"]["budget_status"]
          status_changed_at?: string | null
          total_budget?: number | null
          total_hours?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_user_id?: string | null
          area?: string | null
          assigned_user_id?: string | null
          brief_link?: string | null
          budget_template_id?: string | null
          client_contact_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"] | null
          discount_percentage?: number | null
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          expected_close_date?: string | null
          id?: string
          margin_percentage?: number | null
          name?: string
          objective?: string | null
          payment_terms?: string | null
          project_id?: string | null
          project_type?: string
          secondary_objective?: string | null
          status?: Database["public"]["Enums"]["budget_status"]
          status_changed_at?: string | null
          total_budget?: number | null
          total_hours?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_budget_template_id_fkey"
            columns: ["budget_template_id"]
            isOneToOne: false
            referencedRelation: "budget_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_client_contact_id_fkey"
            columns: ["client_contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      changelog: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          title: string
          version: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          title: string
          version?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          title?: string
          version?: string | null
        }
        Relationships: []
      }
      client_contact_clients: {
        Row: {
          client_id: string | null
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
        }
        Insert: {
          client_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          client_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "client_contact_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contact_clients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          last_name: string
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          is_primary?: boolean
          last_name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          is_primary?: boolean
          last_name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payment_splits: {
        Row: {
          client_id: string
          created_at: string
          display_order: number | null
          id: string
          payment_mode_id: string
          payment_term_id: string | null
          percentage: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id: string
          payment_term_id?: string | null
          percentage: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id?: string
          payment_term_id?: string | null
          percentage?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payment_splits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payment_splits_payment_mode_id_fkey"
            columns: ["payment_mode_id"]
            isOneToOne: false
            referencedRelation: "payment_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payment_splits_payment_term_id_fkey"
            columns: ["payment_term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_user_id: string | null
          created_at: string
          default_payment_terms: string | null
          drive_folder_id: string | null
          drive_folder_name: string | null
          email: string | null
          fic_id: number | null
          hubspot_id: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          strategic_level: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_user_id?: string | null
          created_at?: string
          default_payment_terms?: string | null
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          email?: string | null
          fic_id?: number | null
          hubspot_id?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          strategic_level?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_user_id?: string | null
          created_at?: string
          default_payment_terms?: string | null
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          email?: string | null
          fic_id?: number | null
          hubspot_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          strategic_level?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cron_failure_notifications: {
        Row: {
          error_message: string | null
          failed_at: string
          id: string
          jobid: number
          jobname: string
          notified_at: string
          runid: number
        }
        Insert: {
          error_message?: string | null
          failed_at: string
          id?: string
          jobid: number
          jobname: string
          notified_at?: string
          runid: number
        }
        Update: {
          error_message?: string | null
          failed_at?: string
          id?: string
          jobid?: number
          jobname?: string
          notified_at?: string
          runid?: number
        }
        Relationships: []
      }
      cron_manual_invocations: {
        Row: {
          command_preview: string | null
          error_message: string | null
          id: string
          invoked_at: string
          invoked_by: string
          jobid: number
          jobname: string
          request_id: number | null
          status: string
        }
        Insert: {
          command_preview?: string | null
          error_message?: string | null
          id?: string
          invoked_at?: string
          invoked_by: string
          jobid: number
          jobname: string
          request_id?: number | null
          status?: string
        }
        Update: {
          command_preview?: string | null
          error_message?: string | null
          id?: string
          invoked_at?: string
          invoked_by?: string
          jobid?: number
          jobname?: string
          request_id?: number | null
          status?: string
        }
        Relationships: []
      }
      discipline_area_mappings: {
        Row: {
          areas: string[]
          created_at: string
          discipline: string
          id: string
          updated_at: string
        }
        Insert: {
          areas?: string[]
          created_at?: string
          discipline: string
          id?: string
          updated_at?: string
        }
        Update: {
          areas?: string[]
          created_at?: string
          discipline?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      external_project_access: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_project_access_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      external_visible_users: {
        Row: {
          created_at: string
          external_user_id: string
          granted_by: string | null
          id: string
          visible_user_id: string
        }
        Insert: {
          created_at?: string
          external_user_id: string
          granted_by?: string | null
          id?: string
          visible_user_id: string
        }
        Update: {
          created_at?: string
          external_user_id?: string
          granted_by?: string | null
          id?: string
          visible_user_id?: string
        }
        Relationships: []
      }
      fic_oauth_tokens: {
        Row: {
          access_token: string
          company_id: number
          company_name: string | null
          created_at: string
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          company_id: number
          company_name?: string | null
          created_at?: string
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          company_id?: number
          company_name?: string | null
          created_at?: string
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      help_feedback: {
        Row: {
          comment: string | null
          context: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          helpful: boolean
          id: string
          query: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          comment?: string | null
          context?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          helpful: boolean
          id?: string
          query?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          comment?: string | null
          context?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          helpful?: boolean
          id?: string
          query?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      hr_employees: {
        Row: {
          azienda: string | null
          bp_unitario: number | null
          cognome: string | null
          contratto: string
          created_at: string
          created_by: string | null
          data_fine: string
          data_inizio: string
          data_inizio_collaborazione: string | null
          data_nascita: string | null
          fringe_annuale: number | null
          id: string
          indirizzo_residenza: string | null
          job_title: string | null
          nome: string | null
          orario: string | null
          ore_freelance: number | null
          profile_id: string | null
          pt_perc: number | null
          ral: number
          sesso: string | null
          stato: string
          team: string | null
          updated_at: string
        }
        Insert: {
          azienda?: string | null
          bp_unitario?: number | null
          cognome?: string | null
          contratto: string
          created_at?: string
          created_by?: string | null
          data_fine?: string
          data_inizio: string
          data_inizio_collaborazione?: string | null
          data_nascita?: string | null
          fringe_annuale?: number | null
          id?: string
          indirizzo_residenza?: string | null
          job_title?: string | null
          nome?: string | null
          orario?: string | null
          ore_freelance?: number | null
          profile_id?: string | null
          pt_perc?: number | null
          ral?: number
          sesso?: string | null
          stato?: string
          team?: string | null
          updated_at?: string
        }
        Update: {
          azienda?: string | null
          bp_unitario?: number | null
          cognome?: string | null
          contratto?: string
          created_at?: string
          created_by?: string | null
          data_fine?: string
          data_inizio?: string
          data_inizio_collaborazione?: string | null
          data_nascita?: string | null
          fringe_annuale?: number | null
          id?: string
          indirizzo_residenza?: string | null
          job_title?: string | null
          nome?: string | null
          orario?: string | null
          ore_freelance?: number | null
          profile_id?: string | null
          pt_perc?: number | null
          ral?: number
          sesso?: string | null
          stato?: string
          team?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hubspot_field_mappings: {
        Row: {
          created_at: string
          entity_type: string
          hubspot_field: string
          hubspot_field_label: string | null
          id: string
          is_active: boolean
          local_field: string
          local_field_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          hubspot_field: string
          hubspot_field_label?: string | null
          id?: string
          is_active?: boolean
          local_field: string
          local_field_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          hubspot_field?: string
          hubspot_field_label?: string | null
          id?: string
          is_active?: boolean
          local_field?: string
          local_field_label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_owner_mappings: {
        Row: {
          created_at: string
          hubspot_owner_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hubspot_owner_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hubspot_owner_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      levels: {
        Row: {
          areas: Database["public"]["Enums"]["level_area"][]
          created_at: string
          hourly_rate: number
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          areas?: Database["public"]["Enums"]["level_area"][]
          created_at?: string
          hourly_rate: number
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          areas?: Database["public"]["Enums"]["level_area"][]
          created_at?: string
          hourly_rate?: number
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meet_attachment_copies: {
        Row: {
          copied_at: string
          copied_by: string | null
          copied_file_id: string | null
          google_event_id: string
          id: string
          project_id: string | null
          source_file_id: string
          tracking_id: string | null
        }
        Insert: {
          copied_at?: string
          copied_by?: string | null
          copied_file_id?: string | null
          google_event_id: string
          id?: string
          project_id?: string | null
          source_file_id: string
          tracking_id?: string | null
        }
        Update: {
          copied_at?: string
          copied_by?: string | null
          copied_file_id?: string | null
          google_event_id?: string
          id?: string
          project_id?: string | null
          source_file_id?: string
          tracking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meet_attachment_copies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meet_attachment_copies_tracking_id_fkey"
            columns: ["tracking_id"]
            isOneToOne: false
            referencedRelation: "activity_time_tracking"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          id: string
          in_app_enabled: boolean
          notification_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          in_app_enabled?: boolean
          notification_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          in_app_enabled?: boolean
          notification_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          project_id: string | null
          read: boolean
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          project_id?: string | null
          read?: boolean
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          project_id?: string | null
          read?: boolean
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_events: {
        Row: {
          actor_type: Database["public"]["Enums"]["offer_event_actor_type"]
          actor_user_id: string | null
          client_ip: unknown
          client_token: string | null
          event_type: string
          id: string
          new_status: Database["public"]["Enums"]["offer_status"] | null
          note: string | null
          occurred_at: string
          offer_version_id: string
          previous_status: Database["public"]["Enums"]["offer_status"] | null
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["offer_event_actor_type"]
          actor_user_id?: string | null
          client_ip?: unknown
          client_token?: string | null
          event_type: string
          id?: string
          new_status?: Database["public"]["Enums"]["offer_status"] | null
          note?: string | null
          occurred_at?: string
          offer_version_id: string
          previous_status?: Database["public"]["Enums"]["offer_status"] | null
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["offer_event_actor_type"]
          actor_user_id?: string | null
          client_ip?: unknown
          client_token?: string | null
          event_type?: string
          id?: string
          new_status?: Database["public"]["Enums"]["offer_status"] | null
          note?: string | null
          occurred_at?: string
          offer_version_id?: string
          previous_status?: Database["public"]["Enums"]["offer_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_events_offer_version_id_fkey"
            columns: ["offer_version_id"]
            isOneToOne: false
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_lines: {
        Row: {
          created_at: string
          description: string
          discount_percentage: number
          display_order: number
          id: string
          line_total: number
          offer_version_id: string
          product_id: string | null
          quantity: number
          revenue_category: string | null
          unit_list_price: number
          updated_at: string
          vat_rate: number
        }
        Insert: {
          created_at?: string
          description: string
          discount_percentage?: number
          display_order?: number
          id?: string
          line_total?: number
          offer_version_id: string
          product_id?: string | null
          quantity?: number
          revenue_category?: string | null
          unit_list_price: number
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          created_at?: string
          description?: string
          discount_percentage?: number
          display_order?: number
          id?: string
          line_total?: number
          offer_version_id?: string
          product_id?: string | null
          quantity?: number
          revenue_category?: string | null
          unit_list_price?: number
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_lines_offer_version_id_fkey"
            columns: ["offer_version_id"]
            isOneToOne: false
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_payment_terms: {
        Row: {
          amount: number | null
          created_at: string
          display_order: number
          id: string
          matured_at: string | null
          maturity_event: Database["public"]["Enums"]["offer_payment_term_maturity_event"]
          maturity_status: Database["public"]["Enums"]["offer_payment_term_maturity_status"]
          offer_version_id: string
          payment_term_id: string
          percentage: number | null
          phase_label: string | null
          scheduled_date: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          display_order?: number
          id?: string
          matured_at?: string | null
          maturity_event: Database["public"]["Enums"]["offer_payment_term_maturity_event"]
          maturity_status?: Database["public"]["Enums"]["offer_payment_term_maturity_status"]
          offer_version_id: string
          payment_term_id: string
          percentage?: number | null
          phase_label?: string | null
          scheduled_date?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          display_order?: number
          id?: string
          matured_at?: string | null
          maturity_event?: Database["public"]["Enums"]["offer_payment_term_maturity_event"]
          maturity_status?: Database["public"]["Enums"]["offer_payment_term_maturity_status"]
          offer_version_id?: string
          payment_term_id?: string
          percentage?: number | null
          phase_label?: string | null
          scheduled_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_payment_terms_offer_version_id_fkey"
            columns: ["offer_version_id"]
            isOneToOne: false
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_payment_terms_payment_term_id_fkey"
            columns: ["payment_term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_public_link_accesses: {
        Row: {
          accessed_at: string
          client_ip: unknown
          id: string
          offer_version_id: string | null
          outcome: string
          public_link_id: string
          user_agent: string | null
        }
        Insert: {
          accessed_at?: string
          client_ip?: unknown
          id?: string
          offer_version_id?: string | null
          outcome: string
          public_link_id: string
          user_agent?: string | null
        }
        Update: {
          accessed_at?: string
          client_ip?: unknown
          id?: string
          offer_version_id?: string | null
          outcome?: string
          public_link_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_public_link_accesses_offer_version_id_fkey"
            columns: ["offer_version_id"]
            isOneToOne: false
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_public_link_accesses_public_link_id_fkey"
            columns: ["public_link_id"]
            isOneToOne: false
            referencedRelation: "offer_public_links"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_public_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_sent_at: string | null
          last_sent_to: string | null
          offer_id: string
          revoked_at: string | null
          revoked_by: string | null
          sent_count: number
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_sent_at?: string | null
          last_sent_to?: string | null
          offer_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          sent_count?: number
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_sent_at?: string | null
          last_sent_to?: string | null
          offer_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          sent_count?: number
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_public_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_public_links_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_public_links_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_signatures: {
        Row: {
          client_ip: unknown
          created_at: string
          decision: Database["public"]["Enums"]["offer_client_decision"]
          document_hash: string
          id: string
          offer_version_id: string
          public_link_id: string
          reject_reason: string | null
          signature_image_path: string | null
          signed_pdf_path: string | null
          signer_email: string | null
          signer_name: string
          signer_role: string | null
          user_agent: string | null
        }
        Insert: {
          client_ip: unknown
          created_at?: string
          decision: Database["public"]["Enums"]["offer_client_decision"]
          document_hash: string
          id?: string
          offer_version_id: string
          public_link_id: string
          reject_reason?: string | null
          signature_image_path?: string | null
          signed_pdf_path?: string | null
          signer_email?: string | null
          signer_name: string
          signer_role?: string | null
          user_agent?: string | null
        }
        Update: {
          client_ip?: unknown
          created_at?: string
          decision?: Database["public"]["Enums"]["offer_client_decision"]
          document_hash?: string
          id?: string
          offer_version_id?: string
          public_link_id?: string
          reject_reason?: string | null
          signature_image_path?: string | null
          signed_pdf_path?: string | null
          signer_email?: string | null
          signer_name?: string
          signer_role?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_signatures_offer_version_id_fkey"
            columns: ["offer_version_id"]
            isOneToOne: false
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_signatures_public_link_id_fkey"
            columns: ["public_link_id"]
            isOneToOne: false
            referencedRelation: "offer_public_links"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_version_documents: {
        Row: {
          frozen_at: string
          id: string
          offer_version_id: string
          pdf_generated_at: string | null
          pdf_path: string | null
          snapshot: Json
          snapshot_hash: string
        }
        Insert: {
          frozen_at?: string
          id?: string
          offer_version_id: string
          pdf_generated_at?: string | null
          pdf_path?: string | null
          snapshot: Json
          snapshot_hash: string
        }
        Update: {
          frozen_at?: string
          id?: string
          offer_version_id?: string
          pdf_generated_at?: string | null
          pdf_path?: string | null
          snapshot?: Json
          snapshot_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_version_documents_offer_version_id_fkey"
            columns: ["offer_version_id"]
            isOneToOne: true
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_versions: {
        Row: {
          billing_mode: Database["public"]["Enums"]["offer_billing_mode"]
          created_at: string
          created_by: string | null
          id: string
          list_total: number
          offer_id: string
          offered_total: number
          payment_terms: string | null
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
          valid_until: string | null
          version_number: number
        }
        Insert: {
          billing_mode?: Database["public"]["Enums"]["offer_billing_mode"]
          created_at?: string
          created_by?: string | null
          id?: string
          list_total?: number
          offer_id: string
          offered_total?: number
          payment_terms?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          updated_at?: string
          valid_until?: string | null
          version_number: number
        }
        Update: {
          billing_mode?: Database["public"]["Enums"]["offer_billing_mode"]
          created_at?: string
          created_by?: string | null
          id?: string
          list_total?: number
          offer_id?: string
          offered_total?: number
          payment_terms?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          updated_at?: string
          valid_until?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_versions_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          current_version_id: string | null
          id: string
          number: number
          origin: Database["public"]["Enums"]["offer_origin"]
          project_id: string | null
          updated_at: string
          year: number
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          number: number
          origin?: Database["public"]["Enums"]["offer_origin"]
          project_id?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          number?: number
          origin?: Database["public"]["Enums"]["offer_origin"]
          project_id?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "offer_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_modes: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          is_active: boolean | null
          label: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          label: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          label?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      payment_terms: {
        Row: {
          created_at: string
          days: number | null
          display_order: number
          due_basis:
            | Database["public"]["Enums"]["payment_term_due_basis"]
            | null
          id: string
          is_active: boolean
          label: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          days?: number | null
          display_order?: number
          due_basis?:
            | Database["public"]["Enums"]["payment_term_due_basis"]
            | null
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          days?: number | null
          display_order?: number
          due_basis?:
            | Database["public"]["Enums"]["payment_term_due_basis"]
            | null
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      performance_objectives: {
        Row: {
          bonus_percentage: number | null
          created_at: string
          description: string | null
          id: string
          review_id: string
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          bonus_percentage?: number | null
          created_at?: string
          description?: string | null
          id?: string
          review_id: string
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          bonus_percentage?: number | null
          created_at?: string
          description?: string | null
          id?: string
          review_id?: string
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_objectives_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "performance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_profiles: {
        Row: {
          career_long_term_goal: string | null
          career_target_role: string | null
          company_support: string | null
          compensation: string | null
          contract_history: string | null
          contract_type: string | null
          created_at: string
          id: string
          job_title: string | null
          start_date: string | null
          team: string | null
          team_leader_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          career_long_term_goal?: string | null
          career_target_role?: string | null
          company_support?: string | null
          compensation?: string | null
          contract_history?: string | null
          contract_type?: string | null
          created_at?: string
          id?: string
          job_title?: string | null
          start_date?: string | null
          team?: string | null
          team_leader_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          career_long_term_goal?: string | null
          career_target_role?: string | null
          company_support?: string | null
          compensation?: string | null
          contract_history?: string | null
          contract_type?: string | null
          created_at?: string
          id?: string
          job_title?: string | null
          start_date?: string | null
          team?: string | null
          team_leader_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_quarterly_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          quarter: string
          review_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quarter: string
          review_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quarter?: string
          review_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_quarterly_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_quarterly_notes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "performance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          career_long_term_goal: string | null
          career_target_role: string | null
          company_support: string | null
          compensation: string | null
          compilation_period: string | null
          compiled_by: string | null
          contract_history: string | null
          contract_type: string | null
          created_at: string
          id: string
          improvement_areas: string | null
          job_title: string | null
          start_date: string | null
          strengths: string | null
          team: string | null
          team_leader_name: string | null
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          career_long_term_goal?: string | null
          career_target_role?: string | null
          company_support?: string | null
          compensation?: string | null
          compilation_period?: string | null
          compiled_by?: string | null
          contract_history?: string | null
          contract_type?: string | null
          created_at?: string
          id?: string
          improvement_areas?: string | null
          job_title?: string | null
          start_date?: string | null
          strengths?: string | null
          team?: string | null
          team_leader_name?: string | null
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          career_long_term_goal?: string | null
          career_target_role?: string | null
          company_support?: string | null
          compensation?: string | null
          compilation_period?: string | null
          compiled_by?: string | null
          contract_history?: string | null
          contract_type?: string | null
          created_at?: string
          id?: string
          improvement_areas?: string | null
          job_title?: string | null
          start_date?: string | null
          strengths?: string | null
          team?: string | null
          team_leader_name?: string | null
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviews_compiled_by_fkey"
            columns: ["compiled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_payment_splits: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          payment_mode_id: string
          payment_term_id: string | null
          percentage: number
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id: string
          payment_term_id?: string | null
          percentage: number
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id?: string
          payment_term_id?: string | null
          percentage?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_payment_splits_payment_mode_id_fkey"
            columns: ["payment_mode_id"]
            isOneToOne: false
            referencedRelation: "payment_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_payment_splits_payment_term_id_fkey"
            columns: ["payment_term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_payment_splits_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_service_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_service_subcategories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_service_subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          fic_id: number | null
          gross_price: number
          id: string
          name: string
          net_price: number
          payment_terms: string | null
          product_nature: Database["public"]["Enums"]["product_nature"] | null
          revenue_category: string | null
          terms_text: string | null
          updated_at: string
          user_id: string
          vat_rate: number
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          fic_id?: number | null
          gross_price: number
          id?: string
          name: string
          net_price: number
          payment_terms?: string | null
          product_nature?: Database["public"]["Enums"]["product_nature"] | null
          revenue_category?: string | null
          terms_text?: string | null
          updated_at?: string
          user_id: string
          vat_rate?: number
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          fic_id?: number | null
          gross_price?: number
          id?: string
          name?: string
          net_price?: number
          payment_terms?: string | null
          product_nature?: Database["public"]["Enums"]["product_nature"] | null
          revenue_category?: string | null
          terms_text?: string | null
          updated_at?: string
          user_id?: string
          vat_rate?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved: boolean | null
          area: string | null
          avatar_url: string | null
          bio: string | null
          contract_hours: number | null
          contract_hours_period:
            | Database["public"]["Enums"]["contract_hours_period"]
            | null
          contract_type: Database["public"]["Enums"]["contract_type"] | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          hourly_rate: number | null
          id: string
          interests: string[]
          languages: Json
          last_name: string | null
          level_id: string | null
          skills: string[]
          target_productivity_percentage: number | null
          title: string | null
          updated_at: string
        }
        Insert: {
          approved?: boolean | null
          area?: string | null
          avatar_url?: string | null
          bio?: string | null
          contract_hours?: number | null
          contract_hours_period?:
            | Database["public"]["Enums"]["contract_hours_period"]
            | null
          contract_type?: Database["public"]["Enums"]["contract_type"] | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          hourly_rate?: number | null
          id: string
          interests?: string[]
          languages?: Json
          last_name?: string | null
          level_id?: string | null
          skills?: string[]
          target_productivity_percentage?: number | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          approved?: boolean | null
          area?: string | null
          avatar_url?: string | null
          bio?: string | null
          contract_hours?: number | null
          contract_hours_period?:
            | Database["public"]["Enums"]["contract_hours_period"]
            | null
          contract_type?: Database["public"]["Enums"]["contract_type"] | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          hourly_rate?: number | null
          id?: string
          interests?: string[]
          languages?: Json
          last_name?: string | null
          level_id?: string | null
          skills?: string[]
          target_productivity_percentage?: number | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      project_additional_costs: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          name: string
          project_id: string
          supplier_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          project_id: string
          supplier_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          project_id?: string
          supplier_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_additional_costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_additional_costs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      project_audit_log: {
        Row: {
          action: string
          created_at: string
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_project_audit_log_project"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_progress_updates: {
        Row: {
          created_at: string
          id: string
          progress_value: number
          project_id: string
          roadblocks_text: string | null
          update_text: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          progress_value: number
          project_id: string
          roadblocks_text?: string | null
          update_text?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          progress_value?: number
          project_id?: string
          roadblocks_text?: string | null
          update_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_progress_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_quarter_webhook_log: {
        Row: {
          id: string
          project_id: string
          quarter_number: number
          sent_at: string
          trigger_date: string
          webhook_response: string | null
          webhook_status: number | null
        }
        Insert: {
          id?: string
          project_id: string
          quarter_number: number
          sent_at?: string
          trigger_date: string
          webhook_response?: string | null
          webhook_status?: number | null
        }
        Update: {
          id?: string
          project_id?: string
          quarter_number?: number
          sent_at?: string
          trigger_date?: string
          webhook_response?: string | null
          webhook_status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_quarter_webhook_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_services: {
        Row: {
          created_at: string
          id: string
          project_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          assignee_id: string | null
          budget_item_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string
          recurrence_end_date: string | null
          recurrence_interval: number
          recurrence_parent_id: string | null
          recurrence_rule: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          budget_item_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id: string
          recurrence_end_date?: string | null
          recurrence_interval?: number
          recurrence_parent_id?: string | null
          recurrence_rule?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          budget_item_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string
          recurrence_end_date?: string | null
          recurrence_interval?: number
          recurrence_parent_id?: string | null
          recurrence_rule?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_timesheet_adjustments: {
        Row: {
          adjustment_type: string
          created_at: string | null
          id: string
          percentage: number
          project_id: string
          target_id: string
          updated_at: string | null
        }
        Insert: {
          adjustment_type: string
          created_at?: string | null
          id?: string
          percentage?: number
          project_id: string
          target_id: string
          updated_at?: string | null
        }
        Update: {
          adjustment_type?: string
          created_at?: string | null
          id?: string
          percentage?: number
          project_id?: string
          target_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_timesheet_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_update_drafts: {
        Row: {
          created_at: string
          draft_content: string
          drive_docs_count: number | null
          generated_from: string
          gmail_inbox_used: string | null
          gmail_messages_count: number | null
          id: string
          project_id: string
          published_progress_update_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slack_messages_count: number | null
          sources_used: Json
          status: string
          week_start: string
        }
        Insert: {
          created_at?: string
          draft_content: string
          drive_docs_count?: number | null
          generated_from?: string
          gmail_inbox_used?: string | null
          gmail_messages_count?: number | null
          id?: string
          project_id: string
          published_progress_update_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slack_messages_count?: number | null
          sources_used?: Json
          status?: string
          week_start: string
        }
        Update: {
          created_at?: string
          draft_content?: string
          drive_docs_count?: number | null
          generated_from?: string
          gmail_inbox_used?: string | null
          gmail_messages_count?: number | null
          id?: string
          project_id?: string
          published_progress_update_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slack_messages_count?: number | null
          sources_used?: Json
          status?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_update_drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_update_drafts_published_progress_update_id_fkey"
            columns: ["published_progress_update_id"]
            isOneToOne: false
            referencedRelation: "project_progress_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_update_drafts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_user_id: string | null
          area: string | null
          assigned_user_id: string | null
          billing_type: string | null
          brief_link: string | null
          budget_template_id: string | null
          client_contact_id: string | null
          client_id: string | null
          created_at: string
          description: string | null
          discipline: Database["public"]["Enums"]["discipline"] | null
          discount_percentage: number | null
          drive_folder_id: string | null
          drive_folder_name: string | null
          end_date: string | null
          id: string
          is_billable: boolean | null
          manual_activities_budget: number | null
          manual_quote_number: string | null
          margin_percentage: number | null
          name: string
          objective: string | null
          payment_terms: string | null
          progress: number | null
          project_leader_id: string | null
          project_status: Database["public"]["Enums"]["project_status"] | null
          project_type: string
          projection_critical_threshold: number | null
          projection_warning_threshold: number | null
          secondary_objective: string | null
          slack_channel_id: string | null
          slack_channel_name: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["budget_status"]
          status_changed_at: string | null
          timesheet_share_token: string | null
          timesheet_token_created_at: string | null
          timesheet_token_expiry_days: number | null
          total_budget: number | null
          total_hours: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_user_id?: string | null
          area?: string | null
          assigned_user_id?: string | null
          billing_type?: string | null
          brief_link?: string | null
          budget_template_id?: string | null
          client_contact_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"] | null
          discount_percentage?: number | null
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          end_date?: string | null
          id?: string
          is_billable?: boolean | null
          manual_activities_budget?: number | null
          manual_quote_number?: string | null
          margin_percentage?: number | null
          name: string
          objective?: string | null
          payment_terms?: string | null
          progress?: number | null
          project_leader_id?: string | null
          project_status?: Database["public"]["Enums"]["project_status"] | null
          project_type: string
          projection_critical_threshold?: number | null
          projection_warning_threshold?: number | null
          secondary_objective?: string | null
          slack_channel_id?: string | null
          slack_channel_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["budget_status"]
          status_changed_at?: string | null
          timesheet_share_token?: string | null
          timesheet_token_created_at?: string | null
          timesheet_token_expiry_days?: number | null
          total_budget?: number | null
          total_hours?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_user_id?: string | null
          area?: string | null
          assigned_user_id?: string | null
          billing_type?: string | null
          brief_link?: string | null
          budget_template_id?: string | null
          client_contact_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"] | null
          discount_percentage?: number | null
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          end_date?: string | null
          id?: string
          is_billable?: boolean | null
          manual_activities_budget?: number | null
          manual_quote_number?: string | null
          margin_percentage?: number | null
          name?: string
          objective?: string | null
          payment_terms?: string | null
          progress?: number | null
          project_leader_id?: string | null
          project_status?: Database["public"]["Enums"]["project_status"] | null
          project_type?: string
          projection_critical_threshold?: number | null
          projection_warning_threshold?: number | null
          secondary_objective?: string | null
          slack_channel_id?: string | null
          slack_channel_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["budget_status"]
          status_changed_at?: string | null
          timesheet_share_token?: string | null
          timesheet_token_created_at?: string | null
          timesheet_token_expiry_days?: number | null
          total_budget?: number | null
          total_hours?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_budget_template_id_fkey"
            columns: ["budget_template_id"]
            isOneToOne: false
            referencedRelation: "budget_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_contact_id_fkey"
            columns: ["client_contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_budgets: {
        Row: {
          budget_id: string
          created_at: string
          id: string
          quote_id: string
        }
        Insert: {
          budget_id: string
          created_at?: string
          id?: string
          quote_id: string
        }
        Update: {
          budget_id?: string
          created_at?: string
          id?: string
          quote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_budgets_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_budgets_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_payment_splits: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          payment_mode_id: string
          payment_term_id: string | null
          percentage: number
          quote_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id: string
          payment_term_id?: string | null
          percentage: number
          quote_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id?: string
          payment_term_id?: string | null
          percentage?: number
          quote_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_payment_splits_payment_mode_id_fkey"
            columns: ["payment_mode_id"]
            isOneToOne: false
            referencedRelation: "payment_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_payment_splits_payment_term_id_fkey"
            columns: ["payment_term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_payment_splits_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          budget_id: string | null
          created_at: string
          discount_percentage: number | null
          discounted_total: number
          fic_document_id: number | null
          generated_at: string
          id: string
          margin_percentage: number | null
          project_id: string | null
          quote_number: string
          status: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_id?: string | null
          created_at?: string
          discount_percentage?: number | null
          discounted_total?: number
          fic_document_id?: number | null
          generated_at?: string
          id?: string
          margin_percentage?: number | null
          project_id?: string | null
          quote_number: string
          status?: string
          total_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_id?: string | null
          created_at?: string
          discount_percentage?: number | null
          discounted_total?: number
          fic_document_id?: number | null
          generated_at?: string
          id?: string
          margin_percentage?: number | null
          project_id?: string | null
          quote_number?: string
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_access_settings: boolean
          can_change_project_status: boolean
          can_create_projects: boolean
          can_create_quotes: boolean
          can_delete_projects: boolean
          can_delete_quotes: boolean
          can_download_quotes: boolean
          can_edit_budget: boolean
          can_edit_financial_fields: boolean
          can_edit_projects: boolean
          can_edit_quotes: boolean
          can_manage_categories: boolean
          can_manage_clients: boolean
          can_manage_levels: boolean
          can_manage_products: boolean
          can_manage_services: boolean
          can_manage_templates: boolean
          can_manage_users: boolean
          can_view_all_projects: boolean
          created_at: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          can_access_settings?: boolean
          can_change_project_status?: boolean
          can_create_projects?: boolean
          can_create_quotes?: boolean
          can_delete_projects?: boolean
          can_delete_quotes?: boolean
          can_download_quotes?: boolean
          can_edit_budget?: boolean
          can_edit_financial_fields?: boolean
          can_edit_projects?: boolean
          can_edit_quotes?: boolean
          can_manage_categories?: boolean
          can_manage_clients?: boolean
          can_manage_levels?: boolean
          can_manage_products?: boolean
          can_manage_services?: boolean
          can_manage_templates?: boolean
          can_manage_users?: boolean
          can_view_all_projects?: boolean
          created_at?: string
          id?: string
          role: string
          updated_at?: string
        }
        Update: {
          can_access_settings?: boolean
          can_change_project_status?: boolean
          can_create_projects?: boolean
          can_create_quotes?: boolean
          can_delete_projects?: boolean
          can_delete_quotes?: boolean
          can_download_quotes?: boolean
          can_edit_budget?: boolean
          can_edit_financial_fields?: boolean
          can_edit_projects?: boolean
          can_edit_quotes?: boolean
          can_manage_categories?: boolean
          can_manage_clients?: boolean
          can_manage_levels?: boolean
          can_manage_products?: boolean
          can_manage_services?: boolean
          can_manage_templates?: boolean
          can_manage_users?: boolean
          can_view_all_projects?: boolean
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_payment_splits: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          payment_mode_id: string
          payment_term_id: string | null
          percentage: number
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id: string
          payment_term_id?: string | null
          percentage: number
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          payment_mode_id?: string
          payment_term_id?: string | null
          percentage?: number
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_payment_splits_payment_mode_id_fkey"
            columns: ["payment_mode_id"]
            isOneToOne: false
            referencedRelation: "payment_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_payment_splits_payment_term_id_fkey"
            columns: ["payment_term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_payment_splits_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          budget_template_id: string | null
          category: string
          code: string
          created_at: string
          description: string | null
          discipline: Database["public"]["Enums"]["discipline"] | null
          gross_price: number
          id: string
          name: string
          net_price: number
          payment_terms: string | null
          updated_at: string
          user_id: string
          vat_rate: number
        }
        Insert: {
          budget_template_id?: string | null
          category: string
          code: string
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"] | null
          gross_price: number
          id?: string
          name: string
          net_price: number
          payment_terms?: string | null
          updated_at?: string
          user_id: string
          vat_rate?: number
        }
        Update: {
          budget_template_id?: string | null
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          discipline?: Database["public"]["Enums"]["discipline"] | null
          gross_price?: number
          id?: string
          name?: string
          net_price?: number
          payment_terms?: string | null
          updated_at?: string
          user_id?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_budget_template_id_fkey"
            columns: ["budget_template_id"]
            isOneToOne: false
            referencedRelation: "budget_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          fic_id: number | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          user_id: string
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          fic_id?: number | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          fic_id?: number | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      team_leader_areas: {
        Row: {
          area: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          area: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          area?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_action_logs: {
        Row: {
          action_description: string
          action_type: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action_description: string
          action_type: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action_description?: string
          action_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      user_activity_completions: {
        Row: {
          budget_item_id: string
          completed_at: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          budget_item_id: string
          completed_at?: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          budget_item_id?: string
          completed_at?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_completions_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_calendar_settings: {
        Row: {
          created_at: string
          default_slot_duration: number
          default_view: string
          id: string
          number_of_days: number
          show_weekends: boolean
          timezone: string
          updated_at: string
          user_id: string
          week_starts_on: number
          work_day_end: string
          work_day_start: string
          zoom_level: number
        }
        Insert: {
          created_at?: string
          default_slot_duration?: number
          default_view?: string
          id?: string
          number_of_days?: number
          show_weekends?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
          week_starts_on?: number
          work_day_end?: string
          work_day_start?: string
          zoom_level?: number
        }
        Update: {
          created_at?: string
          default_slot_duration?: number
          default_view?: string
          id?: string
          number_of_days?: number
          show_weekends?: boolean
          timezone?: string
          updated_at?: string
          user_id?: string
          week_starts_on?: number
          work_day_end?: string
          work_day_start?: string
          zoom_level?: number
        }
        Relationships: []
      }
      user_contract_periods: {
        Row: {
          contract_hours: number
          contract_hours_period: string
          contract_type: string
          created_at: string
          end_date: string | null
          hourly_rate: number
          id: string
          source: string
          start_date: string
          target_productivity_percentage: number
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_hours?: number
          contract_hours_period?: string
          contract_type?: string
          created_at?: string
          end_date?: string | null
          hourly_rate?: number
          id?: string
          source?: string
          start_date: string
          target_productivity_percentage?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_hours?: number
          contract_hours_period?: string
          contract_type?: string
          created_at?: string
          end_date?: string | null
          hourly_rate?: number
          id?: string
          source?: string
          start_date?: string
          target_productivity_percentage?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_google_tokens: {
        Row: {
          access_token: string
          created_at: string
          id: string
          refresh_token: string
          selected_calendars: string[] | null
          token_expiry: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          refresh_token: string
          selected_calendars?: string[] | null
          token_expiry: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          refresh_token?: string
          selected_calendars?: string[] | null
          token_expiry?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_hours_adjustments: {
        Row: {
          adjustment_hours: number
          created_at: string
          created_by: string
          id: string
          month: string
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          adjustment_hours?: number
          created_at?: string
          created_by: string
          id?: string
          month: string
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          adjustment_hours?: number
          created_at?: string
          created_by?: string
          id?: string
          month?: string
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_hours_carryover: {
        Row: {
          carryover_hours: number
          created_at: string
          created_by: string
          id: string
          notes: string | null
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          carryover_hours?: number
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          carryover_hours?: number
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workflow_flow_tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          depends_on_task_id: string | null
          description: string | null
          display_order: number
          due_date: string | null
          flow_id: string
          id: string
          is_completed: boolean
          task_template_id: string | null
          title: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          depends_on_task_id?: string | null
          description?: string | null
          display_order?: number
          due_date?: string | null
          flow_id: string
          id?: string
          is_completed?: boolean
          task_template_id?: string | null
          title: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          depends_on_task_id?: string | null
          description?: string | null
          display_order?: number
          due_date?: string | null
          flow_id?: string
          id?: string
          is_completed?: boolean
          task_template_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_flow_tasks_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "workflow_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_flow_tasks_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_flows: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          custom_name: string
          id: string
          owner_id: string
          template_id: string | null
          template_name: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_name: string
          id?: string
          owner_id: string
          template_id?: string | null
          template_name: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_name?: string
          id?: string
          owner_id?: string
          template_id?: string | null
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_flows_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_task_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "workflow_flow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_task_templates: {
        Row: {
          created_at: string
          depends_on_task_id: string | null
          description: string | null
          display_order: number
          id: string
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id?: string | null
          description?: string | null
          display_order?: number
          id?: string
          template_id: string
          title: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string | null
          description?: string | null
          display_order?: number
          id?: string
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_task_templates_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "workflow_task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_task_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          area: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_get_cron_jobs_status: {
        Args: never
        Returns: {
          active: boolean
          command: string
          failures_24h: number
          jobid: number
          jobname: string
          last_failure_at: string
          last_run_at: string
          last_run_message: string
          last_run_status: string
          last_success_at: string
          schedule: string
          total_runs_24h: number
        }[]
      }
      admin_get_cron_runs: {
        Args: { p_limit?: number }
        Returns: {
          duration_ms: number
          end_time: string
          jobid: number
          jobname: string
          return_message: string
          runid: number
          schedule: string
          start_time: string
          status: string
        }[]
      }
      admin_get_manual_invocations: {
        Args: { p_limit?: number }
        Returns: {
          error_message: string
          http_responded_at: string
          http_response_preview: string
          http_status_code: number
          id: string
          invoked_at: string
          invoked_by: string
          invoked_by_name: string
          jobid: number
          jobname: string
          request_id: number
          status: string
        }[]
      }
      admin_get_progress_drafts_status: {
        Args: { p_week_start: string }
        Returns: {
          client_name: string
          draft_created_at: string
          draft_id: string
          drive_count: number
          gmail_count: number
          gmail_inbox_used: string
          has_drive: boolean
          has_gmail_sources: boolean
          has_slack: boolean
          last_cron_run_at: string
          last_cron_run_status: string
          project_id: string
          project_leader_email: string
          project_leader_id: string
          project_leader_name: string
          project_name: string
          reason: string
          slack_count: number
          status: string
        }[]
      }
      admin_run_cron_job_now: { Args: { p_jobid: number }; Returns: Json }
      admin_set_cron_secret: { Args: { p_secret: string }; Returns: string }
      attach_offer_signature_pdf: {
        Args: { _pdf_path: string; _signature_id: string }
        Returns: undefined
      }
      attach_offer_version_pdf: {
        Args: {
          _expected_snapshot_hash?: string
          _offer_version_id: string
          _pdf_path: string
        }
        Returns: {
          frozen_at: string
          id: string
          offer_version_id: string
          pdf_generated_at: string | null
          pdf_path: string | null
          snapshot: Json
          snapshot_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "offer_version_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      build_offer_version_snapshot: {
        Args: { _offer_version_id: string }
        Returns: Json
      }
      can_access_project_tasks: {
        Args: { _project_id: string }
        Returns: boolean
      }
      can_manage_offer: { Args: { _offer_id: string }; Returns: boolean }
      can_manage_offer_version: {
        Args: { _offer_version_id: string }
        Returns: boolean
      }
      can_manage_workflow_templates: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_update_project_progress: {
        Args: { _project_id: string }
        Returns: boolean
      }
      cleanup_old_action_logs: { Args: never; Returns: undefined }
      compute_payment_term_due_date: {
        Args: { _document_date: string; _payment_term_id: string }
        Returns: string
      }
      create_offer_public_link: {
        Args: { _expires_in_days?: number; _offer_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_sent_at: string | null
          last_sent_to: string | null
          offer_id: string
          revoked_at: string | null
          revoked_by: string | null
          sent_count: number
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "offer_public_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_user_completely: { Args: { _user_id: string }; Returns: undefined }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      freeze_offer_version_document: {
        Args: { _offer_version_id: string }
        Returns: {
          frozen_at: string
          id: string
          offer_version_id: string
          pdf_generated_at: string | null
          pdf_path: string | null
          snapshot: Json
          snapshot_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "offer_version_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_hourly_rates_for_costing: {
        Args: { _user_ids?: string[] }
        Returns: {
          hourly_rate: number
          id: string
        }[]
      }
      get_offer_approval_thresholds: {
        Args: never
        Returns: {
          amount_threshold: number
          discount_threshold_percentage: number
        }[]
      }
      get_offer_version_effective_discount_percentage: {
        Args: { _offer_version_id: string }
        Returns: number
      }
      get_profiles_by_roles: {
        Args: { role_filter: Database["public"]["Enums"]["app_role"][] }
        Returns: {
          email: string
          first_name: string
          id: string
          last_name: string
        }[]
      }
      get_profiles_compensation: {
        Args: { _user_ids?: string[] }
        Returns: {
          contract_hours: number
          contract_hours_period: Database["public"]["Enums"]["contract_hours_period"]
          contract_type: Database["public"]["Enums"]["contract_type"]
          hourly_rate: number
          id: string
        }[]
      }
      get_profiles_hr_public: {
        Args: { _user_ids?: string[] }
        Returns: {
          data_inizio: string
          data_inizio_collaborazione: string
          data_nascita: string
          indirizzo_residenza: string
          job_title: string
          profile_id: string
          sesso: string
          team: string
        }[]
      }
      get_user_email_preference: {
        Args: { p_notification_type: string; p_user_id: string }
        Returns: boolean
      }
      get_user_hourly_rate_at_date: {
        Args: { p_date?: string; p_user_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_approved_user: { Args: { _user_id: string }; Returns: boolean }
      is_editor_or_admin: { Args: { _user_id: string }; Returns: boolean }
      mark_offer_payment_term_matured: {
        Args: { _matured_at?: string; _offer_payment_term_id: string }
        Returns: {
          amount: number | null
          created_at: string
          display_order: number
          id: string
          matured_at: string | null
          maturity_event: Database["public"]["Enums"]["offer_payment_term_maturity_event"]
          maturity_status: Database["public"]["Enums"]["offer_payment_term_maturity_status"]
          offer_version_id: string
          payment_term_id: string
          percentage: number | null
          phase_label: string | null
          scheduled_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "offer_payment_terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      merge_clients: {
        Args: { drop_id: string; final_name?: string; keep_id: string }
        Returns: Json
      }
      notify_offer_approval_outcome: {
        Args: { _approved: boolean; _offer_version_id: string; _reason: string }
        Returns: undefined
      }
      notify_offer_approval_required: {
        Args: { _offer_version_id: string; _reason: string }
        Returns: undefined
      }
      notify_offer_client_activity: {
        Args: { _detail?: string; _kind: string; _offer_version_id: string }
        Returns: undefined
      }
      notify_user_if_enabled: {
        Args: {
          _message: string
          _project_id?: string
          _title: string
          _type: string
          _user_id: string
        }
        Returns: undefined
      }
      offer_version_requires_approval: {
        Args: { _offer_version_id: string }
        Returns: boolean
      }
      recalculate_all_pack_projects_progress: {
        Args: never
        Returns: {
          confirmed_hours: number
          new_progress: number
          old_progress: number
          planned_hours: number
          project_id: string
          project_name: string
        }[]
      }
      record_offer_client_decision: {
        Args: {
          _client_ip?: unknown
          _decision: Database["public"]["Enums"]["offer_client_decision"]
          _expected_document_hash: string
          _reject_reason?: string
          _signature_image_path?: string
          _signer_email?: string
          _signer_name: string
          _signer_role?: string
          _token: string
          _user_agent?: string
        }
        Returns: Json
      }
      record_offer_link_sent: {
        Args: { _public_link_id: string; _sent_to: string }
        Returns: undefined
      }
      resolve_offer_public_link: {
        Args: { _client_ip?: unknown; _token: string; _user_agent?: string }
        Returns: Json
      }
      restore_user: { Args: { _user_id: string }; Returns: undefined }
      revoke_offer_public_link: {
        Args: { _public_link_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_sent_at: string | null
          last_sent_to: string | null
          offer_id: string
          revoked_at: string | null
          revoked_by: string | null
          sent_count: number
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "offer_public_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_offer_version_status: {
        Args: {
          _actor_type: Database["public"]["Enums"]["offer_event_actor_type"]
          _actor_user_id?: string
          _client_ip?: unknown
          _client_token?: string
          _event_type: string
          _new_status: Database["public"]["Enums"]["offer_status"]
          _note?: string
          _offer_version_id: string
        }
        Returns: {
          actor_type: Database["public"]["Enums"]["offer_event_actor_type"]
          actor_user_id: string | null
          client_ip: unknown
          client_token: string | null
          event_type: string
          id: string
          new_status: Database["public"]["Enums"]["offer_status"] | null
          note: string | null
          occurred_at: string
          offer_version_id: string
          previous_status: Database["public"]["Enums"]["offer_status"] | null
        }
        SetofOptions: {
          from: "*"
          to: "offer_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      soft_delete_user: { Args: { _user_id: string }; Returns: undefined }
      supersede_other_offer_versions: {
        Args: {
          _also_supersede_accepted?: boolean
          _keep_version_id: string
          _offer_id: string
        }
        Returns: undefined
      }
      validate_offer_payment_terms_balance: {
        Args: { _offer_version_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "account"
        | "finance"
        | "team_leader"
        | "coordinator"
        | "member"
        | "external"
      budget_status:
        | "in_attesa"
        | "approvato"
        | "rifiutato"
        | "bozza"
        | "in_revisione"
      contract_hours_period: "daily" | "weekly" | "monthly"
      contract_type: "full-time" | "part-time" | "freelance" | "consuntivo"
      discipline:
        | "content_creation_storytelling"
        | "paid_advertising_media_buying"
        | "website_landing_page_development"
        | "brand_identity_visual_design"
        | "social_media_management"
        | "email_marketing_automation"
        | "seo_content_optimization"
        | "crm_customer_data_platform"
        | "software_development_integration"
        | "ai_implementation_automation"
        | "strategic_consulting"
      level_area: "marketing" | "tech" | "branding" | "sales" | "interno" | "ai"
      offer_billing_mode:
        | "importo_finito"
        | "ricorrente"
        | "a_giornate"
        | "tetto_di_spesa"
      offer_client_decision: "accettata" | "rifiutata"
      offer_event_actor_type: "user" | "client" | "system"
      offer_origin: "commercial" | "tender"
      offer_payment_term_maturity_event:
        | "firma"
        | "consegna"
        | "pubblicazione_fase"
        | "data_calendario"
        | "ricorrente"
      offer_payment_term_maturity_status: "da_maturare" | "maturata"
      offer_status:
        | "bozza"
        | "in_approvazione"
        | "inviata"
        | "vista"
        | "accettata"
        | "rifiutata"
        | "scaduta"
        | "superata"
        | "sostituita"
      payment_term_due_basis: "data_documento" | "fine_mese"
      product_nature: "una_tantum" | "ricorrente" | "a_giornate"
      project_status: "in_partenza" | "aperto" | "da_fatturare" | "completato"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: [
        "admin",
        "account",
        "finance",
        "team_leader",
        "coordinator",
        "member",
        "external",
      ],
      budget_status: [
        "in_attesa",
        "approvato",
        "rifiutato",
        "bozza",
        "in_revisione",
      ],
      contract_hours_period: ["daily", "weekly", "monthly"],
      contract_type: ["full-time", "part-time", "freelance", "consuntivo"],
      discipline: [
        "content_creation_storytelling",
        "paid_advertising_media_buying",
        "website_landing_page_development",
        "brand_identity_visual_design",
        "social_media_management",
        "email_marketing_automation",
        "seo_content_optimization",
        "crm_customer_data_platform",
        "software_development_integration",
        "ai_implementation_automation",
        "strategic_consulting",
      ],
      level_area: ["marketing", "tech", "branding", "sales", "interno", "ai"],
      offer_billing_mode: [
        "importo_finito",
        "ricorrente",
        "a_giornate",
        "tetto_di_spesa",
      ],
      offer_client_decision: ["accettata", "rifiutata"],
      offer_event_actor_type: ["user", "client", "system"],
      offer_origin: ["commercial", "tender"],
      offer_payment_term_maturity_event: [
        "firma",
        "consegna",
        "pubblicazione_fase",
        "data_calendario",
        "ricorrente",
      ],
      offer_payment_term_maturity_status: ["da_maturare", "maturata"],
      offer_status: [
        "bozza",
        "in_approvazione",
        "inviata",
        "vista",
        "accettata",
        "rifiutata",
        "scaduta",
        "superata",
        "sostituita",
      ],
      payment_term_due_basis: ["data_documento", "fine_mese"],
      product_nature: ["una_tantum", "ricorrente", "a_giornate"],
      project_status: ["in_partenza", "aperto", "da_fatturare", "completato"],
    },
  },
} as const
