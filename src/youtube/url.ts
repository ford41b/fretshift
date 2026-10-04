const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/**
 * Returns the 11-character video ID for youtube.com/watch?v=, youtu.be/ and
 * youtube.com/shorts/ links, else null. Mirrors parseYouTubeVideoId in
 * supabase/functions/youtube-import/core.ts; the server re-validates.
 */
export function parseYouTubeVideoId(input: string): string | null {
  let text = input.trim();
  if (!text || text.length > 500) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1) id = parts[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === "/watch" || url.pathname === "/watch/") id = url.searchParams.get("v");
    else id = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/** "83", "83.5", "1:23" or "1:02:03" → seconds; blank → undefined; invalid → null. */
export function parseTimecode(input: string): number | undefined | null {
  const text = input.trim();
  if (!text) return undefined;
  if (!/^\d+(?:\.\d+)?$|^\d+:[0-5]?\d(?:\.\d+)?$|^\d+:[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(text)) return null;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
