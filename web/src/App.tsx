import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
import { SignIn } from './pages/SignIn'
import { Workspace } from './pages/Workspace'
import { Workspaces } from './pages/Workspaces'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Workspaces />} />
            <Route path="/w/:id" element={<Workspace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
