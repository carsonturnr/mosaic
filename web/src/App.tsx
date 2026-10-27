import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
import { WorkspaceModeContext } from './lib/workspaceBase'
import { Landing } from './pages/Landing'
import { Privacy } from './pages/Privacy'
import { Report } from './pages/Report'
import { Label } from './pages/Label'
import { Settings } from './pages/Settings'
import { SignIn } from './pages/SignIn'
import { Terms } from './pages/Terms'
import { AdDetail } from './pages/AdDetail'
import { Briefs } from './pages/Briefs'
import { DemoEntry } from './pages/DemoEntry'
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
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/demo" element={<DemoEntry />} />
          <Route element={<DemoMode />}>
            <Route path="/demo/w/:id" element={<Workspace />} />
            <Route path="/demo/w/:id/library" element={<Library />} />
            <Route path="/demo/w/:id/ads/:adId" element={<AdDetail />} />
            <Route path="/demo/w/:id/analysis" element={<Analysis />} />
            <Route path="/demo/w/:id/report" element={<Report />} />
            <Route path="/demo/w/:id/briefs" element={<Briefs />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/app" element={<Workspaces />} />
            <Route path="/app/evals" element={<Evals />} />
            <Route path="/app/w/:id" element={<Workspace />} />
            <Route path="/app/w/:id/library" element={<Library />} />
            <Route path="/app/w/:id/ads/:adId" element={<AdDetail />} />
            <Route path="/app/w/:id/analysis" element={<Analysis />} />
            <Route path="/app/w/:id/report" element={<Report />} />
            <Route path="/app/w/:id/briefs" element={<Briefs />} />
            <Route path="/app/w/:id/settings" element={<Settings />} />
            <Route path="/app/w/:id/label" element={<Label />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

function DemoMode() {
  return (
    <WorkspaceModeContext.Provider value={{ base: '/demo', readOnly: true }}>
      <Outlet />
    </WorkspaceModeContext.Provider>
  )
}
