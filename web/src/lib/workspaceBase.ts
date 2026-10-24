import { createContext, useContext } from 'react'

export interface WorkspaceMode {
  /** '/app' for signed-in users, '/demo' for the public read-only demo */
  base: '/app' | '/demo'
  readOnly: boolean
}

export const WorkspaceModeContext = createContext<WorkspaceMode>({ base: '/app', readOnly: false })

export function useWorkspaceMode(): WorkspaceMode {
  return useContext(WorkspaceModeContext)
}
