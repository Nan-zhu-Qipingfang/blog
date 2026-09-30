export const prerender = false;

import type { APIRoute } from "astro";

/**
 * GET /api/music/stream?id=<songId>
 *
 * NetEase's "outer url" (https://music.163.com/song/media/outer/url?id=X.mp3)
 * is HTTPS, but it **302-redirects to an `http://` CDN host**. On an HTTPS page
 * that is active mixed content -> the browser silently blocks the audio, so the
 * player looks "dead" even though the metadata API is fine.
 *
 * This endpoint resolves the redirect server-side and re-issues it with `https`,
 * so the browser only ever talks to HTTPS URLs. Resolving happens at play time
 * (the CDN links are signed and time-boxed), which is why this is a redirect
 * rather than a URL baked into the /api/music/random response.
 */
const TIMEOUT_MS = 7000;
const OUTER_URL = "https://music.163.com/song/media/outer/url";

/** Only numeric NetEase song ids — prevents open-redirect / SSRF via this route. */
const ID_RE = /^\d{1,20}$/;

function httpsify(url: string): string {
  return url.startsWith("http://")
    ? `https://${url.slice("http://".length)}`
    : url;
}

export const GET: APIRoute = async ({ request }) => {
  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!ID_RE.test(id)) {
    return new Response("invalid song id", { status: 400 });
  }

  const outer = `${OUTER_URL}?id=${id}.mp3`;

  try {
    const res = await fetch(outer, {
      // manual: we only want the Location header, not the whole audio body
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        referer: "https://music.163.com/",
      },
    });

    const location = res.headers.get("location");

    // Never keep the socket around with an unread body.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }

    // Direct 200 (no redirect): make sure it is really audio before handing it
    // over, otherwise the player would silently fail on an HTML error page.
    if (!location) {
      const type = res.headers.get("content-type") ?? "";
      if (
        res.status >= 400 ||
        (type && !type.includes("audio") && !type.includes("octet-stream"))
      ) {
        return new Response("song unavailable", { status: 502 });
      }
    }

    const target = location ? httpsify(location) : outer;

    return new Response(null, {
      status: 302,
      headers: {
        location: target,
        // signed CDN links expire — never let a CDN cache the redirect
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
};
