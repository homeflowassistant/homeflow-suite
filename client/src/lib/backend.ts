export function getBackendBaseUrl(): string {
  return (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
}

export function getBackendUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getBackendBaseUrl();

  if (!baseUrl) {
    return normalizedPath;
  }

  return `${baseUrl}${normalizedPath}`;
}