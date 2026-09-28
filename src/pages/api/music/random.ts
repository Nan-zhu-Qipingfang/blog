export const prerender = false;

/**
 * GET /api/music/random
 * Picks a random track from NetEase's official hot-songs chart playlist
 * (server-side, no key needed). Returns song meta, the free streaming url
 * (music.163.com/song/media/outer/url) and LRC lyrics.
 */
const TIMEOUT_MS = 7000;
const HOT_PLAYLIST = "3778678"; // 云音乐热歌榜

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.json();
}

let cachedTracks: any[] = [];

async function getTracks(): Promise<any[]> {
  if (cachedTracks.length) return cachedTracks;
  const j = await fetchJson(
    `https://music.163.com/api/playlist/detail?id=${HOT_PLAYLIST}`,
  );
  cachedTracks = (j?.result?.tracks ?? []).filter((t: any) => t?.id);
  return cachedTracks;
}

export async function GET() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const tracks = await getTracks();
      if (!tracks.length) break;
      const song = tracks[Math.floor(Math.random() * tracks.length)];
      // skip VIP-only tracks — their free outer url won't stream
      if (song.fee === 1) continue;

      const artist = (song.artists ?? []).map((a: any) => a.name).join("/");
      const pic = song.album?.picUrl || song.artists?.[0]?.picUrl || "";

      let lrc = "";
      try {
        const lj = await fetchJson(
          `https://music.163.com/api/song/lyric?id=${song.id}&lv=1`,
        );
        lrc = lj?.lrc?.lyric || "";
      } catch {
        /* lyrics optional */
      }

      return Response.json({
        ok: true,
        name: song.name,
        artist,
        pic,
        url: `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`,
        lrc,
      });
    } catch {
      /* retry */
    }
  }
  return Response.json({ ok: false, error: "音乐服务暂不可用" }, { status: 502 });
}
