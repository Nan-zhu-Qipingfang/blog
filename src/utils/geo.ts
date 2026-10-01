/**
 * IP → 属地（地区）。
 *
 * 保存评论时顺手查一次，只取省市一级展示。免费接口按「国内可达 + 无需 key」
 * 排序依次重试，全部失败就返回空串（评论照常保存，只是不显示地区）。
 * 结果按 IP 在进程内缓存 30 分钟，避免同一个人反复评论刷接口配额。
 */
import { SITE } from "@/config";

type Level = "city" | "region" | "country";

const level: Level = (SITE as { commentRegion?: { detail?: Level } }).commentRegion
  ?.detail ?? "city";

const cache = new Map<string, { at: number; value: string }>();
const TTL = 30 * 60 * 1000;

/** 从 x-forwarded-for / x-real-ip 里取第一个公网 IP（Vercel 会带一段代理链）。 */
export function clientIp(headers?: Headers | null): string {
  const h = headers as Headers | undefined;
  if (h) {
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first && /^\d{1,3}(\.\d{1,3}){3}$/.test(first)) return first;
    }
    const real = h.get("x-real-ip")?.trim();
    if (real && /^\d{1,3}(\.\d{1,3}){3}$/.test(real)) return real;
  }
  return "";
}

async function fetchJson(url: string, ms = 2000): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 返回 "浙江 · 杭州" 这种展示串，拿不到就返回 ""。 */
export async function lookupRegion(ip: string): Promise<string> {
  if (!ip) return "";
  const enabled = (SITE as { commentRegion?: { enabled?: boolean } }).commentRegion?.enabled !== false;
  if (!enabled) return "";

  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const Providers: Array<{ url: string; pick: (j: Record<string, unknown>) => string }> = [
    {
      // freeipapi：国内可达、无需 key，字段最全
      url: `https://freeipapi.com/api/json/${ip}`,
      pick: j => {
        const country = String(j.countryName ?? j.countryCode ?? "");
        const region = String(j.regionName ?? "");
        const city = String(j.cityName ?? "");
        return joinParts(country, region, city);
      },
    },
    {
      // ipapi.co 兜底
      url: `https://ipapi.co/${ip}/json/`,
      pick: j => {
        const country = String(j.country_name ?? j.country_code ?? "");
        const region = String(j.region ?? "");
        const city = String(j.city ?? "");
        return joinParts(country, region, city);
      },
    },
    {
      // ipinfo.io 兜底
      url: `https://ipinfo.io/${ip}/json`,
      pick: j => {
        const country = String(j.country ?? "");
        const region = String(j.region ?? "");
        const city = String(j.city ?? "");
        return joinParts(country, region, city);
      },
    },
  ];

  for (const p of Providers) {
    const j = await fetchJson(p.url);
    if (!j) continue;
    const value = p.pick(j).trim();
    if (value) {
      cache.set(ip, { at: Date.now(), value });
      return value;
    }
  }
  return "";
}

function joinParts(country: string, region: string, city: string): string {
  if (level === "country") return compact(country);
  if (level === "region") return compact([country, region].filter(Boolean).join(" · "));
  return compact([country, region, city].filter(Boolean).join(" · "));
}

function compact(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[·,]+(?=[·,])/g, "·").trim().slice(0, 40);
}
