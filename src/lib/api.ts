type ApiSuccess<T> = {
  success: true
  data: T
}

type ApiFailure = {
  success: false
  error: string
}

// 4.0.9: 网络层异常（请求根本没到服务器）翻译成人话并给出处置指引。
// 浏览器对网络失败的报文各不相同：Chrome/Edge "Failed to fetch"、Safari "Load failed"、
// Firefox "NetworkError when attempting to fetch resource"。
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  )
}

function networkErrorMessage(): string {
  return '网络连接中断，请求没有到达服务器（已自动重试仍失败）。请检查本机网络后重试；若反复出现：① 换 Chrome 浏览器打开本系统 ② 尝试切换手机热点排查公司网络/防火墙拦截 ③ 新建报销页右上角把识别方式切换为“服务器端识别”。'
}

async function request<T>(input: string, init?: RequestInit, retryOnNetwork = true): Promise<T> {
  let response: Response
  // 4.0.9: 统一超时兜底，任何请求都不会无限挂起（否则页面交互会被一直卡住）
  const hasBody = init?.body !== undefined && init?.body !== null
  const timeoutMs = hasBody ? 180_000 : 30_000
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    response = await fetch(input, {
      credentials: 'include',
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
      ...init,
      signal: init?.signal ?? controller.signal,
    })
  } catch (error) {
    // 网络瞬断很常见：幂等的 GET 自动重试一次再放弃
    if (retryOnNetwork && isNetworkError(error)) {
      await new Promise((resolve) => window.setTimeout(resolve, 400))
      return request<T>(input, init, false)
    }
    if (isNetworkError(error)) {
      throw new Error(networkErrorMessage())
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒无响应），请检查网络后重试。`)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }

  let payload: ApiSuccess<T> | ApiFailure
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure
  } catch {
    // 服务器返回了非 JSON（如网关错误页）
    if (response.status >= 500) {
      throw new Error('服务器繁忙或正在维护，请稍等几秒后重试。')
    }
    throw new Error('服务器响应异常，请刷新页面后重试。')
  }
  if (!response.ok || !payload.success) {
    throw new Error('error' in payload ? payload.error : '请求失败')
  }

  return payload.data
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown, isForm = false) =>
    request<T>(url, {
      method: 'POST',
      body: isForm ? (body as FormData) : JSON.stringify(body ?? {}),
    }),
  patch: <T>(url: string, body?: unknown, isForm = false) =>
    request<T>(url, {
      method: 'PATCH',
      body: isForm ? (body as FormData) : JSON.stringify(body ?? {}),
    }),
  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    }),
}
