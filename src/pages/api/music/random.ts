export const prerender = false;

/**
 * GET /api/music/random
 * Picks a random track from NetEase's official hot-songs chart playlist
 * (server-side, no key needed). Returns song meta, the free streaming url
 * (music.163.com/song/media/outer/url) and LRC lyrics.
 */
const TIMEOUT_MS = 7000;
const HOT_PLAYLIST = "3778678"; // 云音乐热歌榜
const OUTER_URL = "https://music.163.com/song/media/outer/url";

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  referer: "https://music.163.com/",
};

/** NetEase hands out `http://p*.music.126.net` image URLs — upgrade them,
 *  otherwise an HTTPS page blocks them as mixed content. */
function httpsify(url: string): string {
  return typeof url === "string" && url.startsWith("http://")
    ? `https://${url.slice("http://".length)}`
    : (url ?? "");
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.json();
}

let cachedTracks: any[] = [];

async function getTracks(): Promise<any[]> {
  if (cachedTracks.length) return cachedTracks;
  const j = await fetchJson(
    `https://music.163.com/api/playlist/detail?id=${HOT_PLAYLIST}`
  );
  cachedTracks = (j?.result?.tracks ?? []).filter((t: any) => t?.id);
  return cachedTracks;
}

/**
 * Ask NetEase whether this id can actually be streamed before we hand it to the
 * player. Plenty of chart entries have no free outer url (they answer with an
 * HTML page or 404), which is what made the pill bounce between "换一首" and an
 * error. Cheap: manual redirect, body never downloaded.
 */
async function isPlayable(id: number | string): Promise<boolean> {
  try {
    const res = await fetch(`${OUTER_URL}?id=${id}.mp3`, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: BROWSER_HEADERS,
    });
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    if (res.headers.get("location")) return true;
    if (res.status >= 400) return false;
    const type = res.headers.get("content-type") ?? "";
    return !type || type.includes("audio") || type.includes("octet-stream");
  } catch {
    return false;
  }
}

export async function GET() {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const tracks = await getTracks();
      if (!tracks.length) break;
      const song = tracks[Math.floor(Math.random() * tracks.length)];
      // skip VIP-only tracks — their free outer url won't stream
      if (song.fee === 1) continue;
      // skip tracks NetEase won't actually serve (dead outer url)
      if (!(await isPlayable(song.id))) continue;

      const artist = (song.artists ?? []).map((a: any) => a.name).join("/");
      const pic = httpsify(
        song.album?.picUrl || song.artists?.[0]?.picUrl || ""
      );

      let lrc = "";
      try {
        const lj = await fetchJson(
          `https://music.163.com/api/song/lyric?id=${song.id}&lv=1`
        );
        lrc = lj?.lrc?.lyric || "";
      } catch {
        /* lyrics optional */
      }

      return Response.json(
        {
          ok: true,
          name: song.name,
          artist,
          pic,
          // Never hand the raw NetEase outer url to the browser: it 302s to an
          // `http://` CDN host, which HTTPS pages block as mixed content.
          // /api/music/stream resolves it server-side and forces https.
          url: `/api/music/stream?id=${song.id}`,
          lrc,
        },
        { headers: { "cache-control": "no-store, max-age=0" } }
      );
    } catch {
      /* retry */
    }
  }
  return Response.json(
    { ok: false, error: "音乐服务暂不可用" },
    { status: 502 }
  );
}
