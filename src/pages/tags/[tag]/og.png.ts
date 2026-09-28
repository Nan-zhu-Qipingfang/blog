import type { APIRoute, GetStaticPathsResult } from "astro";
import { getCollection } from "astro:content";
import getUniqueTags from "@/utils/getUniqueTags";
import { generateOgImageForTag } from "@/utils/generateOgImages";
import { SITE } from "@/config";

export async function getStaticPaths(): Promise<GetStaticPathsResult> {
  const [blogPosts, galleryPosts] = await Promise.all([
    getCollection("blog"),
    SITE.showGalleries && SITE.showGalleriesInIndex
      ? getCollection("galleries")
      : Promise.resolve([]),
  ]);
  const posts = [...blogPosts, ...galleryPosts];
  const tags = getUniqueTags(posts);

  return tags.map(({ tag, tagName }) => ({
    params: { tag },
    props: { tagName },
  }));
}

export const GET: APIRoute = async ({ props }) => {
  const buffer = await generateOgImageForTag(props.tagName as string);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/png" },
  });
};
