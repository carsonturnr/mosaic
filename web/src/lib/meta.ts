// Facebook JS SDK loader and login. Returns a short-lived user token; the worker
// exchanges it for a long-lived one and stores it in Supabase Vault.

interface FbAuthResponse {
  accessToken: string
  userID: string
}
interface FbLoginResponse {
  status: string
  authResponse?: FbAuthResponse
}
interface FbSdk {
  init: (opts: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }) => void
  login: (
    cb: (res: FbLoginResponse) => void,
    opts: { scope?: string; config_id?: string; response_type?: string },
  ) => void
}

declare global {
  interface Window {
    FB?: FbSdk
    fbAsyncInit?: () => void
  }
}

const SCOPES = 'ads_read,ads_management,business_management'
let loading: Promise<FbSdk> | null = null

export function loadFacebookSdk(): Promise<FbSdk> {
  if (window.FB) return Promise.resolve(window.FB)
  if (loading) return loading
  const appId = import.meta.env.VITE_META_APP_ID
  if (!appId) return Promise.reject(new Error('VITE_META_APP_ID is not set'))
  loading = new Promise<FbSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new Error('FB SDK failed to initialise'))
      window.FB.init({ appId, version: 'v26.0', cookie: false, xfbml: false })
      resolve(window.FB)
    }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.onerror = () => reject(new Error('could not load the Facebook SDK'))
    document.head.appendChild(script)
  })
  return loading
}

export async function loginWithFacebook(): Promise<string> {
  const FB = await loadFacebookSdk()
  const configId = import.meta.env.VITE_META_CONFIG_ID
  return new Promise((resolve, reject) => {
    FB.login(
      (res) => {
        if (res.status === 'connected' && res.authResponse?.accessToken) {
          resolve(res.authResponse.accessToken)
        } else {
          reject(new Error('Facebook login was cancelled or not authorised'))
        }
      },
      configId ? { config_id: configId } : { scope: SCOPES },
    )
  })
}
