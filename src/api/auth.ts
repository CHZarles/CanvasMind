import { buildApiUrl } from './http'

// 登录方式类型。
export type AuthMethodType =
  | 'ADMIN_PASSWORD'
  | 'EMAIL_PASSWORD'
  | 'PHONE_CODE'
  | 'EMAIL_CODE'
  | 'WECHAT_OAUTH'
  | 'GITHUB_OAUTH'
  | 'GOOGLE_OAUTH'
  | 'CUSTOM_OAUTH'

// 登录方式分类。
export type AuthMethodCategory = 'PASSWORD' | 'CODE' | 'OAUTH'

// 登录用户信息。
export interface AuthUserProfile {
  id: string
  name: string
  phone: string
  email: string
  maskedPhone: string
  maskedEmail: string
  avatarUrl: string
  role: 'USER' | 'ADMIN'
  loginMethodType: AuthMethodType
}

// 前端可见登录方式配置。
export interface PublicAuthMethod {
  methodType: AuthMethodType
  category: AuthMethodCategory
  displayName: string
  description: string
  iconType: string
  iconUrl: string
  isEnabled: boolean
  isVisible: boolean
  sortOrder: number
  allowAutoFill: boolean
  allowSignUp: boolean
  config: Record<string, any>
}

// 验证码接口返回结构。
export interface AuthVerificationCodeResult {
  id: string
  target: string
  channel: 'PHONE' | 'EMAIL'
  expiresAt: string
  debugCode?: string
}

// 登录会话接口返回结构。
export interface AuthSessionResult {
  user: AuthUserProfile | null
  expiresAt?: string
}

// OAuth 授权地址结构。
export interface AuthOAuthAuthorizeResult {
  authUrl: string
}

// 管理后台登录方式配置结构。
export interface AuthMethodConfigPayload extends PublicAuthMethod {}

const AUTH_TOKEN_KEY = 'adflow:auth-token'
const AUTH_PROFILE_KEY = 'adflow:auth-profile'

const emailPasswordMethod: PublicAuthMethod = {
  methodType: 'EMAIL_PASSWORD',
  category: 'PASSWORD',
  displayName: '邮箱密码登录',
  description: '使用现有平台账号登录',
  iconType: 'email',
  iconUrl: '',
  isEnabled: true,
  isVisible: true,
  sortOrder: 0,
  allowAutoFill: true,
  allowSignUp: false,
  config: {
    targetLabel: '邮箱',
    placeholder: '请输入邮箱',
    passwordPlaceholder: '请输入登录密码',
  },
}

const readToken = () => typeof window === 'undefined'
  ? ''
  : String(window.localStorage.getItem(AUTH_TOKEN_KEY) || '').trim()

const clearStoredAuth = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
  window.localStorage.removeItem(AUTH_PROFILE_KEY)
}

const readStoredProfile = () => {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(AUTH_PROFILE_KEY) || 'null') as AuthUserProfile | null
  } catch {
    return null
  }
}

const errorMessage = (payload: any, status: number) => String(
  payload?.error?.message || payload?.error || payload?.message || `请求失败 (${status})`,
)

const requestJson = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(buildApiUrl(path), init)
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(errorMessage(payload, response.status))
  return payload
}

const verifyToken = async (token: string) => {
  const payload = await requestJson('/api/auth/token/verify', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  const id = String(payload?.userId || '').trim()
  if (!id) throw new Error('登录凭证无效')
  return id
}

const maskEmail = (email: string) => {
  const [name = '', domain = ''] = email.split('@')
  if (!domain) return email
  return `${name.slice(0, 2)}${name.length > 2 ? '***' : ''}@${domain}`
}

export const getAuthHeaders = (): Record<string, string> => {
  const token = readToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// 获取当前启用的登录方式。
export const listEnabledAuthMethods = async () => {
  return [emailPasswordMethod]
}

// 获取全部登录方式配置。
export const listAuthMethodConfigs = async () => {
  return [emailPasswordMethod]
}

// 保存全部登录方式配置。
export const saveAuthMethodConfigs = async (methods: AuthMethodConfigPayload[]) => {
  return methods
}

// 请求验证码。
export const requestAuthVerificationCode = async (
  payload: { methodType: AuthMethodType; target: string },
): Promise<AuthVerificationCodeResult> => {
  await requestJson('/api/sendEmail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: payload.target }),
  })
  return {
    id: '',
    target: payload.target,
    channel: 'EMAIL' as const,
    expiresAt: '',
  }
}

// 提交验证码登录。
export const loginByVerificationCode = async (payload: {
  methodType: AuthMethodType
  target: string
  code?: string
  password?: string
}) => {
  if (!payload.password) throw new Error('请输入登录密码')
  const result = await requestJson('/api/emailLogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: payload.target.trim(), password: payload.password }),
  })
  const token = String(result?.token || '').trim()
  if (!token) throw new Error('登录服务未返回凭证')
  const id = await verifyToken(token)
  const email = payload.target.trim()
  const profile: AuthUserProfile = {
    id,
    name: String(result?.nickname || result?.username || email),
    phone: String(result?.phone || ''),
    email,
    maskedPhone: '',
    maskedEmail: maskEmail(email),
    avatarUrl: String(result?.headimg || ''),
    role: 'USER',
    loginMethodType: 'EMAIL_PASSWORD',
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token)
    window.localStorage.setItem(AUTH_PROFILE_KEY, JSON.stringify(profile))
  }
  return { user: profile }
}

// 获取 OAuth 跳转地址。
export const createOAuthAuthorizeUrl = async (payload: {
  methodType: AuthMethodType
  redirectUri?: string
  state?: string
}): Promise<AuthOAuthAuthorizeResult> => {
  void payload
  throw new Error('当前仅支持邮箱密码登录')
}

// 获取当前登录会话。
export const getAuthSession = async () => {
  const token = readToken()
  if (!token) return { user: null }
  try {
    const id = await verifyToken(token)
    const stored = readStoredProfile()
    return {
      user: stored?.id === id ? stored : {
        id,
        name: `用户 ${id}`,
        phone: '',
        email: '',
        maskedPhone: '',
        maskedEmail: '',
        avatarUrl: '',
        role: 'USER' as const,
        loginMethodType: 'EMAIL_PASSWORD' as const,
      },
    }
  } catch {
    clearStoredAuth()
    return { user: null }
  }
}

// 退出当前登录会话。
export const logoutAuthSession = async () => {
  clearStoredAuth()
  return { success: true }
}
