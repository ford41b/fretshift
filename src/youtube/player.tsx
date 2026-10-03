import { useEffect, useRef } from "react";

/** The subset of HTMLAudioElement the review timeline uses; YouTube implements it too. */
export type MediaHandle = {
  readonly paused: boolean;
  currentTime: number;
  playbackRate: number;
  preservesPitch?: boolean;
  play(): Promise<void>;
  pause(): void;
};

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
};
type YTNamespace = {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    host?: string;
    width?: string | number;
    height?: string | number;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: () => void;
      onError?: (event: { data: number }) => void;
      onStateChange?: (event: { data: number }) => void;
    };
  }) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = "https://www.youtube.com/iframe_api";
let loading: Promise<YTNamespace> | null = null;

/** Loads YouTube's IFrame Player API once. Playback stays inside YouTube's player; no media is fetched by FretShift. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("The YouTube player could not load. Check your connection."));
    };
    document.head.append(script);
  });
  return loading;
}

const PLAYING = 1;

/**
 * Adapts the IFrame player to MediaHandle. The API reports time in coarse
 * steps, so currentTime extrapolates from the last change while playing; tap
 * tempo and the playhead stay smooth between player updates.
 */
export class YouTubeMedia implements MediaHandle {
  private sample = { time: 0, at: 0, playing: false };
  private rate = 1;
  preservesPitch = true;
  constructor(private readonly player: YTPlayer) {}
  refresh() {
    const playing = this.player.getPlayerState() === PLAYING;
    const time = this.player.getCurrentTime() || 0;
    if (time !== this.sample.time || playing !== this.sample.playing)
      this.sample = { time, at: performance.now(), playing };
  }
  get paused() {
    return !this.sample.playing;
  }
  get currentTime() {
    const { time, at, playing } = this.sample;
    return playing ? time + ((performance.now() - at) / 1000) * this.rate : time;
  }
  set currentTime(seconds: number) {
    this.player.seekTo(seconds, true);
    this.sample = { time: seconds, at: performance.now(), playing: this.sample.playing };
  }
  get playbackRate() {
    return this.rate;
  }
  set playbackRate(rate: number) {
    this.rate = rate;
    this.player.setPlaybackRate(rate);
  }
  get duration() {
    return this.player.getDuration() || 0;
  }
  // Update the playing state at once so a tap right after Play is not rejected
  // while waiting for the next player poll.
  play() {
    this.player.playVideo();
    this.sample = { time: this.currentTime, at: performance.now(), playing: true };
    return Promise.resolve();
  }
  pause() {
    this.player.pauseVideo();
    this.sample = { time: this.currentTime, at: performance.now(), playing: false };
  }
}

const ERRORS: Record<number, string> = {
  2: "YouTube rejected this video ID.",
  5: "This browser cannot play the YouTube video.",
  100: "This YouTube video is private, removed or unavailable.",
  101: "The video's owner does not allow playback in other apps.",
  150: "The video's owner does not allow playback in other apps.",
};

/** Embedded player (privacy-enhanced host). Reports its media handle, duration and time. */
export function YouTubePlayer({ videoId, start = 0, onReady, onTime, onError }: {
  videoId: string;
  start?: number;
  onReady?: (media: YouTubeMedia, duration: number) => void;
  onTime?: (seconds: number) => void;
  onError?: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onTime, onError });
  callbacks.current = { onReady, onTime, onError };
  useEffect(() => {
    let player: YTPlayer | null = null;
    let timer = 0;
    let live = true;
    const container = host.current;
    const mount = document.createElement("div");
    container?.append(mount);
    loadYouTubeApi().then((YT) => {
      if (!live) return;
      player = new YT.Player(mount, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, start: Math.floor(start), origin: window.location.origin },
        events: {
          onReady: () => {
            if (!live || !player) return;
            const media = new YouTubeMedia(player);
            callbacks.current.onReady?.(media, media.duration);
            timer = window.setInterval(() => {
              media.refresh();
              callbacks.current.onTime?.(media.currentTime);
            }, 100);
          },
          onError: (event) => callbacks.current.onError?.(ERRORS[event.data] ?? "The YouTube player reported an error."),
        },
      });
    }).catch((error: unknown) => {
      if (live) callbacks.current.onError?.(error instanceof Error ? error.message : String(error));
    });
    return () => {
      live = false;
      window.clearInterval(timer);
      try { player?.destroy(); } catch { /* the iframe may already be gone */ }
      // The API replaces `mount` with its iframe; clear whatever is left.
      container?.replaceChildren();
    };
  }, [videoId, start]);
  return <div className="yt-player" ref={host} aria-label="YouTube video player" />;
}
