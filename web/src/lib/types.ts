import type { Database } from './database.types'

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type Workspace = Tables<'workspaces'>
export type DataSource = Tables<'data_sources'>
export type SyncRun = Tables<'sync_runs'>
