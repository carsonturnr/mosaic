import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
import { Landing } from './pages/Landing'
import { Privacy } from './pages/Privacy'
import { Report } from './pages/Report'
import { Label } from './pages/Label'
import { Settings } from './pages/Settings'
import { SignIn } from './pages/SignIn'
import { Terms } from './pages/Terms'
import { AdDetail } from './pages/AdDetail'
import { Briefs } from './pages/Briefs'
import { DataDeletion } from './pages/DataDeletion'
import { Evals } from './pages/Evals'
import { Analysis } from './pages/Analysis'
import { Library } from './pages/Library'
import { Workspace } from './pages/Workspace'
import { Workspaces } from './pages/Workspaces'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/data-deletion" element={<DataDeletion />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/demo/*" element={<Navigate to="/" replace />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/app" element={<Workspaces />} />
              <Route path="/app/evals" element={<Evals />} />
            </Route>
            <Route path="/app/w/:id" element={<AppShell />}>{workspacePages(true)}</Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

/** Child routes of a workspace; settings and labeling are owner-only. */
function workspacePages(owner: boolean) {
  return (
    <>
      <Route index element={<Workspace />} />
      <Route path="library" element={<Library />} />
      <Route path="ads/:adId" element={<AdDetail />} />
      <Route path="analysis" element={<Analysis />} />
      <Route path="report" element={<Report />} />
      <Route path="briefs" element={<Briefs />} />
      {owner && <Route path="settings" element={<Settings />} />}
      {owner && <Route path="label" element={<Label />} />}
    </>
  )
}
