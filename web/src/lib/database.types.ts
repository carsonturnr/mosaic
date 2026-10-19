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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ad_custom_tags: {
        Row: {
          ad_id: string
          custom_tag_id: string
        }
        Insert: {
          ad_id: string
          custom_tag_id: string
        }
        Update: {
          ad_id?: string
          custom_tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_custom_tags_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_custom_tags_custom_tag_id_fkey"
            columns: ["custom_tag_id"]
            isOneToOne: false
            referencedRelation: "custom_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_daily_metrics: {
        Row: {
          ad_id: string
          clicks: number | null
          date: string
          impressions: number
          link_clicks: number | null
          purchase_value: number | null
          purchases: number | null
          reach: number | null
          spend: number
          synced_at: string
          video_3s_views: number | null
          video_p100: number | null
          video_p25: number | null
          video_p50: number | null
          video_p75: number | null
          video_thruplays: number | null
        }
        Insert: {
          ad_id: string
          clicks?: number | null
          date: string
          impressions?: number
          link_clicks?: number | null
          purchase_value?: number | null
          purchases?: number | null
          reach?: number | null
          spend?: number
          synced_at?: string
          video_3s_views?: number | null
          video_p100?: number | null
          video_p25?: number | null
          video_p50?: number | null
          video_p75?: number | null
          video_thruplays?: number | null
        }
        Update: {
          ad_id?: string
          clicks?: number | null
          date?: string
          impressions?: number
          link_clicks?: number | null
          purchase_value?: number | null
          purchases?: number | null
          reach?: number | null
          spend?: number
          synced_at?: string
          video_3s_views?: number | null
          video_p100?: number | null
          video_p25?: number | null
          video_p50?: number | null
          video_p75?: number | null
          video_thruplays?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_daily_metrics_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_sets: {
        Row: {
          campaign_id: string | null
          daily_budget_cents: number | null
          external_id: string
          id: string
          name: string | null
          optimization_goal: string | null
          raw: Json | null
          status: string | null
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          daily_budget_cents?: number | null
          external_id: string
          id?: string
          name?: string | null
          optimization_goal?: string | null
          raw?: Json | null
          status?: string | null
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          daily_budget_cents?: number | null
          external_id?: string
          id?: string
          name?: string | null
          optimization_goal?: string | null
          raw?: Json | null
          status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_sets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_sets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          ad_set_id: string | null
          created_time: string | null
          creative_id: string | null
          external_id: string
          id: string
          name: string | null
          raw: Json | null
          status: string | null
          workspace_id: string
        }
        Insert: {
          ad_set_id?: string | null
          created_time?: string | null
          creative_id?: string | null
          external_id: string
          id?: string
          name?: string | null
          raw?: Json | null
          status?: string | null
          workspace_id: string
        }
        Update: {
          ad_set_id?: string | null
          created_time?: string | null
          creative_id?: string | null
          external_id?: string
          id?: string
          name?: string | null
          raw?: Json | null
          status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_time: string | null
          external_id: string
          id: string
          name: string | null
          objective: string | null
          raw: Json | null
          status: string | null
          workspace_id: string
        }
        Insert: {
          created_time?: string | null
          external_id: string
          id?: string
          name?: string | null
          objective?: string | null
          raw?: Json | null
          status?: string | null
          workspace_id: string
        }
        Update: {
          created_time?: string | null
          external_id?: string
          id?: string
          name?: string | null
          objective?: string | null
          raw?: Json | null
          status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_cluster_members: {
        Row: {
          cluster_id: string
          creative_id: string
        }
        Insert: {
          cluster_id: string
          creative_id: string
        }
        Update: {
          cluster_id?: string
          creative_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_cluster_members_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "concept_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_cluster_members_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_clusters: {
        Row: {
          id: string
          label: string | null
          run_at: string
          summary: string | null
          workspace_id: string
        }
        Insert: {
          id?: string
          label?: string | null
          run_at?: string
          summary?: string | null
          workspace_id: string
        }
        Update: {
          id?: string
          label?: string | null
          run_at?: string
          summary?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_clusters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_embeddings: {
        Row: {
          creative_id: string
          embedding: string | null
          id: string
          kind: string
          model: string
          scene_id: string | null
        }
        Insert: {
          creative_id: string
          embedding?: string | null
          id?: string
          kind: string
          model: string
          scene_id?: string | null
        }
        Update: {
          creative_id?: string
          embedding?: string | null
          id?: string
          kind?: string
          model?: string
          scene_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_embeddings_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_embeddings_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_tags: {
        Row: {
          confidence: number | null
          created_at: string
          creative_id: string
          dimension_key: string
          id: string
          model: string | null
          scene_id: string | null
          source: Database["public"]["Enums"]["tag_source"]
          value: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          creative_id: string
          dimension_key: string
          id?: string
          model?: string | null
          scene_id?: string | null
          source?: Database["public"]["Enums"]["tag_source"]
          value: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          creative_id?: string
          dimension_key?: string
          id?: string
          model?: string | null
          scene_id?: string | null
          source?: Database["public"]["Enums"]["tag_source"]
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_tags_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_tags_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          content_hash: string | null
          cta_type: string | null
          duration_s: number | null
          external_id: string
          headline: string | null
          height: number | null
          id: string
          perception_status: string
          primary_text: string | null
          raw: Json | null
          storage_path: string | null
          thumbnail_path: string | null
          type: Database["public"]["Enums"]["creative_type"]
          width: number | null
          workspace_id: string
        }
        Insert: {
          content_hash?: string | null
          cta_type?: string | null
          duration_s?: number | null
          external_id: string
          headline?: string | null
          height?: number | null
          id?: string
          perception_status?: string
          primary_text?: string | null
          raw?: Json | null
          storage_path?: string | null
          thumbnail_path?: string | null
          type: Database["public"]["Enums"]["creative_type"]
          width?: number | null
          workspace_id: string
        }
        Update: {
          content_hash?: string | null
          cta_type?: string | null
          duration_s?: number | null
          external_id?: string
          headline?: string | null
          height?: number | null
          id?: string
          perception_status?: string
          primary_text?: string | null
          raw?: Json | null
          storage_path?: string | null
          thumbnail_path?: string | null
          type?: Database["public"]["Enums"]["creative_type"]
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_tags: {
        Row: {
          color: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["source_kind"]
          last_synced_at: string | null
          meta_ad_account_id: string | null
          token_secret_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["source_kind"]
          last_synced_at?: string | null
          meta_ad_account_id?: string | null
          token_secret_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["source_kind"]
          last_synced_at?: string | null
          meta_ad_account_id?: string | null
          token_secret_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          created_at: string
          git_sha: string | null
          id: string
          metrics: Json
          suite: string
        }
        Insert: {
          created_at?: string
          git_sha?: string | null
          id?: string
          metrics: Json
          suite: string
        }
        Update: {
          created_at?: string
          git_sha?: string | null
          id?: string
          metrics?: Json
          suite?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          citations: Json | null
          content: Json
          created_at: string
          grounding_passed: boolean | null
          id: string
          input_snapshot: Json | null
          kind: Database["public"]["Enums"]["report_kind"]
          model: string | null
          trace_id: string | null
          workspace_id: string
        }
        Insert: {
          citations?: Json | null
          content: Json
          created_at?: string
          grounding_passed?: boolean | null
          id?: string
          input_snapshot?: Json | null
          kind: Database["public"]["Enums"]["report_kind"]
          model?: string | null
          trace_id?: string | null
          workspace_id: string
        }
        Update: {
          citations?: Json | null
          content?: Json
          created_at?: string
          grounding_passed?: boolean | null
          id?: string
          input_snapshot?: Json | null
          kind?: Database["public"]["Enums"]["report_kind"]
          model?: string | null
          trace_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          broll_type: string | null
          creative_id: string
          end_s: number
          id: string
          idx: number
          keyframe_path: string | null
          on_screen_text: string | null
          start_s: number
          transcript: string | null
          visual_description: string | null
        }
        Insert: {
          broll_type?: string | null
          creative_id: string
          end_s: number
          id?: string
          idx: number
          keyframe_path?: string | null
          on_screen_text?: string | null
          start_s: number
          transcript?: string | null
          visual_description?: string | null
        }
        Update: {
          broll_type?: string | null
          creative_id?: string
          end_s?: number
          id?: string
          idx?: number
          keyframe_path?: string | null
          on_screen_text?: string | null
          start_s?: number
          transcript?: string | null
          visual_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scenes_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          data_source_id: string
          error: string | null
          finished_at: string | null
          id: string
          job: string
          started_at: string
          stats: Json | null
          status: string
        }
        Insert: {
          data_source_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job: string
          started_at?: string
          stats?: Json | null
          status: string
        }
        Update: {
          data_source_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job?: string
          started_at?: string
          stats?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      taxonomy_dimensions: {
        Row: {
          allowed_values: Json | null
          applies_to: string
          description: string | null
          id: string
          key: string
          label: string
          workspace_id: string | null
        }
        Insert: {
          allowed_values?: Json | null
          applies_to?: string
          description?: string | null
          id?: string
          key: string
          label: string
          workspace_id?: string | null
        }
        Update: {
          allowed_values?: Json | null
          applies_to?: string
          description?: string | null
          id?: string
          key?: string
          label?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "taxonomy_dimensions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      ad_daily_metrics_derived: {
        Row: {
          ad_id: string | null
          clicks: number | null
          cpa: number | null
          cpc: number | null
          cpm: number | null
          ctr: number | null
          date: string | null
          hold_rate: number | null
          hook_rate: number | null
          impressions: number | null
          link_clicks: number | null
          purchase_value: number | null
          purchases: number | null
          reach: number | null
          roas: number | null
          spend: number | null
          synced_at: string | null
          video_3s_views: number | null
          video_p100: number | null
          video_p25: number | null
          video_p50: number | null
          video_p75: number | null
          video_thruplays: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_daily_metrics_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      owns_workspace: { Args: { ws: string }; Returns: boolean }
    }
    Enums: {
      creative_type: "video" | "image" | "carousel"
      report_kind: "strategist" | "brief"
      source_kind: "meta_live" | "sandbox_synthetic" | "demo"
      tag_source: "ai" | "user"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      creative_type: ["video", "image", "carousel"],
      report_kind: ["strategist", "brief"],
      source_kind: ["meta_live", "sandbox_synthetic", "demo"],
      tag_source: ["ai", "user"],
    },
  },
} as const
