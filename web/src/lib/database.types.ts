// Hand-written subset of the schema in the shape `supabase gen types` emits.
// Replace once the project is linked:
//   supabase gen types typescript --linked > src/lib/database.types.ts

export type SourceKind = 'meta_live' | 'sandbox_synthetic' | 'demo'

export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          owner_id: string
          name: string
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          is_demo?: boolean
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      source_kind: SourceKind
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Workspace = Database['public']['Tables']['workspaces']['Row']
