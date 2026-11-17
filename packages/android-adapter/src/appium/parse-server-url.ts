export interface ParsedAppiumServer {
  protocol: 'http' | 'https';
  hostname: string;
  port: number;
  path: string;
}

export function parseAppiumServerUrl(
  serverUrl: string,
): { ok: true; server: ParsedAppiumServer } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return { ok: false, message: `Appium server URL is not a valid URL: ${serverUrl}` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'Appium server URL must use http or https.' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'Appium server URL must not include credentials.' };
  }
  if (url.search || url.hash) {
    return { ok: false, message: 'Appium server URL must not include a query or fragment.' };
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: 'Appium server URL has an invalid port.' };
  }

  return {
    ok: true,
    server: {
      protocol: url.protocol === 'https:' ? 'https' : 'http',
      hostname: url.hostname,
      port,
      path: url.pathname.length > 0 ? url.pathname : '/',
    },
  };
}
