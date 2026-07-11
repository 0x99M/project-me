const TIMEOUT_MS = 10_000;

export type StatusReport = {
  url: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
};

export async function checkStatus(url: string): Promise<StatusReport> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "0x99m-status-bot" },
    });
    return {
      url,
      ok: response.ok,
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    // A timeout, DNS failure, or TLS error never yields a status code, so the site
    // is down as far as a visitor is concerned.
    return {
      url,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatStatus(report: StatusReport): string {
  if (report.ok) {
    return `✅ ${report.url} is up\nHTTP ${report.statusCode} in ${report.latencyMs}ms`;
  }
  if (report.statusCode !== undefined) {
    return `⚠️ ${report.url} responded with an error\nHTTP ${report.statusCode} in ${report.latencyMs}ms`;
  }
  return `❌ ${report.url} is unreachable\n${report.error}`;
}
