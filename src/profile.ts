import { note } from "./diagnostics.js";
import { CollectionError, describeError } from "./errors.js";
import { collectEmbeddedJson, deepCollect, isObject, metaContent } from "./extract.js";
import { httpGet, httpGetJson, isStopped } from "./http.js";
import { postsFromEdges } from "./posts.js";
import type { Json, PostData, ProfileData } from "./types.js";
import { parseHumanNumber, toNumber } from "./util.js";

const RESERVED_PATHS = new Set([
  "p", "reel", "reels", "tv", "explore", "accounts", "directory", "about",
  "developer", "legal", "privacy", "terms", "stories", "s", "graphql", "api",
]);

export function parseProfileUrl(input: string): { username: string; profileUrl: string } {
  const raw = (input ?? "").trim();
  if (raw.length === 0 || raw.includes("USERNAME")) {
    throw new CollectionError(
      "CONFIG",
      "The profile URL is still the placeholder. Edit INSTAGRAM_PROFILE_URL in index.ts.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new CollectionError("CONFIG", `Malformed URL: "${raw}"`);
  }

  if (!/(^|\.)instagram\.com$/i.test(url.hostname)) {
    throw new CollectionError("CONFIG", `Not an instagram.com URL: "${raw}"`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new CollectionError("CONFIG", "The URL has no username path segment.");
  }

  const username = segments[0].toLowerCase();
  if (RESERVED_PATHS.has(username)) {
    throw new CollectionError(
      "CONFIG",
      `"${raw}" points at a post or section, not a profile. Use https://www.instagram.com/<username>/`,
    );
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
    throw new CollectionError("CONFIG", `"${username}" is not a valid Instagram username.`);
  }

  return { username, profileUrl: `https://www.instagram.com/${username}/` };
}

export function emptyProfile(username: string, profileUrl: string): ProfileData {
  return {
    username,
    displayName: null,
    biography: null,
    profilePicUrl: null,
    followers: null,
    following: null,
    totalPosts: null,
    profileUrl,
    isPrivate: null,
    isVerified: null,
    externalUrl: null,
    category: null,
    accountType: null,
    userId: null,
  };
}

/** Newer payloads carry the website under `bio_links` instead of `external_url`. */
function firstBioLink(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!isObject(link)) continue;
    const url = link.url ?? link.lynx_url;
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

/** Maps a user node, in any of its several shapes, onto ProfileData. */
function profileFromUserNode(node: Json, base: ProfileData): ProfileData {
  const followers = toNumber((node.edge_followed_by as Json)?.count) ?? toNumber(node.follower_count);
  const following = toNumber((node.edge_follow as Json)?.count) ?? toNumber(node.following_count);
  const totalPosts =
    toNumber((node.edge_owner_to_timeline_media as Json)?.count) ??
    toNumber(node.media_count) ??
    toNumber(node.all_media_count);

  return {
    ...base,
    username: typeof node.username === "string" ? node.username : base.username,
    displayName: typeof node.full_name === "string" && node.full_name ? node.full_name : base.displayName,
    biography: typeof node.biography === "string" && node.biography ? node.biography : base.biography,
    profilePicUrl:
      (typeof node.profile_pic_url_hd === "string" ? node.profile_pic_url_hd : null) ??
      (typeof node.profile_pic_url === "string" ? node.profile_pic_url : null) ??
      base.profilePicUrl,
    followers: followers ?? base.followers,
    following: following ?? base.following,
    totalPosts: totalPosts ?? base.totalPosts,
    isPrivate: typeof node.is_private === "boolean" ? node.is_private : base.isPrivate,
    isVerified: typeof node.is_verified === "boolean" ? node.is_verified : base.isVerified,
    externalUrl:
      (typeof node.external_url === "string" && node.external_url ? node.external_url : null) ??
      firstBioLink(node.bio_links) ??
      base.externalUrl,
    category:
      (typeof node.category_name === "string" ? node.category_name : null) ??
      (typeof node.category === "string" ? node.category : null) ??
      (typeof node.business_category_name === "string" ? node.business_category_name : null) ??
      base.category,
    accountType:
      node.is_business_account === true
        ? "Business"
        : node.is_professional_account === true
          ? "Professional / Creator"
          : node.is_business_account === false
            ? "Personal"
            : base.accountType,
    userId:
      (typeof node.id === "string" ? node.id : null) ??
      (typeof node.pk === "string" ? node.pk : null) ??
      (typeof node.pk === "number" ? String(node.pk) : null) ??
      base.userId,
  };
}

function looksLikeUserNode(n: Json): boolean {
  return (
    typeof n.username === "string" &&
    ("edge_followed_by" in n || "follower_count" in n || "edge_owner_to_timeline_media" in n)
  );
}


function userNodesFor(root: unknown, username: string): Json[] {
  return deepCollect(
    root,
    (n) => looksLikeUserNode(n) && String(n.username).toLowerCase() === username,
  ).sort((x, y) => Object.keys(y).length - Object.keys(x).length);
}

export interface ProfileResult {
  profile: ProfileData;
  seedPosts: PostData[];
  endCursor: string | null;
  /** Reused by post discovery so the document is only fetched once. */
  profileHtml: string | null;
}

export async function collectProfile(username: string, profileUrl: string): Promise<ProfileResult> {
  let profile = emptyProfile(username, profileUrl);
  let seedPosts: PostData[] = [];
  let endCursor: string | null = null;
  let profileHtml: string | null = null;
  const sources: string[] = [];
  const failures: string[] = [];

  try {
    const json = await httpGetJson<Json>(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      profileUrl,
    );
    const users = userNodesFor(json, username);
    if (users.length > 0) {
      for (const user of users) profile = profileFromUserNode(user, profile);
      sources.push("public web_profile_info endpoint");

      const timeline = users[0].edge_owner_to_timeline_media as Json | undefined;
      if (timeline) {
        seedPosts = postsFromEdges(timeline.edges);
        const pageInfo = timeline.page_info as Json | undefined;
        endCursor = typeof pageInfo?.end_cursor === "string" ? pageInfo.end_cursor : null;
      }
    } else {
      failures.push("web_profile_info: no user object in response");
    }
  } catch (err) {
    failures.push(`web_profile_info: ${describeError(err)}`);
  }

  const needsMore = profile.followers === null || profile.totalPosts === null || profile.biography === null;
  if (needsMore && !isStopped()) {
    try {
      const { body: html } = await httpGet(profileUrl, { mode: "document" });
      profileHtml = html;

      const userNodes: Json[] = [];
      for (const blob of collectEmbeddedJson(html)) userNodes.push(...userNodesFor(blob, username));
      userNodes.sort((x, y) => Object.keys(y).length - Object.keys(x).length);

      for (const user of userNodes) {
        profile = profileFromUserNode(user, profile);
        if (!sources.includes("profile HTML (embedded JSON)")) {
          sources.push("profile HTML (embedded JSON)");
        }
        const timeline = user.edge_owner_to_timeline_media as Json | undefined;
        if (timeline && seedPosts.length === 0) {
          seedPosts = postsFromEdges(timeline.edges);
          const pageInfo = timeline.page_info as Json | undefined;
          endCursor = endCursor ?? (typeof pageInfo?.end_cursor === "string" ? pageInfo.end_cursor : null);
        }
      }

      const desc = metaContent(html, "og:description") ?? metaContent(html, "description");
      const counts = desc
        ? /([\d.,]+[KMB]?)\s+Followers?,\s*([\d.,]+[KMB]?)\s+Following,\s*([\d.,]+[KMB]?)\s+Posts?/i.exec(desc)
        : null;
      if (counts) {
        profile.followers = profile.followers ?? parseHumanNumber(counts[1]);
        profile.following = profile.following ?? parseHumanNumber(counts[2]);
        profile.totalPosts = profile.totalPosts ?? parseHumanNumber(counts[3]);
        if (!sources.includes("profile HTML (og: meta tags)")) {
          sources.push("profile HTML (og: meta tags)");
        }
      }

      const ogTitle = metaContent(html, "og:title");
      if (profile.displayName === null && ogTitle) {
        profile.displayName = /^(.*?)\s*\(@/.exec(ogTitle)?.[1]?.trim() ?? profile.displayName;
      }
      profile.profilePicUrl = profile.profilePicUrl ?? metaContent(html, "og:image");
      if (profile.isPrivate === null && /"is_private":\s*true/.test(html)) profile.isPrivate = true;
      if (profile.isVerified === null && /"is_verified":\s*true/.test(html)) profile.isVerified = true;
    } catch (err) {
      failures.push(`profile HTML: ${describeError(err)}`);
    }
  }

  const obtained = [profile.followers, profile.following, profile.totalPosts, profile.biography].filter(
    (v) => v !== null,
  ).length;

  if (sources.length === 0) {
    note(
      "Profile data",
      "UNAVAILABLE",
      "No public profile data was served. Instagram returns the same empty page for a username " +
        "that does not exist and for one it declines to serve to a logged-out client, so the two " +
        "cannot be told apart without signing in." +
        (failures.length ? ` Details: ${failures.join(" | ")}` : ""),
    );
  } else if (obtained >= 3) {
    note("Profile data", "OK", `Source(s): ${sources.join(", ")}.`);
  } else {
    note(
      "Profile data",
      "PARTIAL",
      `Source(s): ${sources.join(", ")}. Missing fields reported as N/A.` +
        (failures.length ? ` Failures: ${failures.join(" | ")}` : ""),
    );
  }

  return { profile, seedPosts, endCursor, profileHtml };
}
