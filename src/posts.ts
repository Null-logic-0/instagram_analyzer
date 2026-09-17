import {
  COLLECT_COMMENTS,
  COLLECT_POST_DETAILS,
  CONSECUTIVE_FAILURE_LIMIT,
  MAX_COMMENTS_PER_POST,
  MAX_POSTS,
  MAX_POSTS_FOR_COMMENTS,
} from "./config.js";
import { note } from "./diagnostics.js";
import { describeError } from "./errors.js";
import {
  collectEmbeddedJson,
  deepCollect,
  deepFindFirst,
  decodeEntities,
  firstNumberMatch,
  isObject,
  metaContent,
  postUrlFromShortcode,
  shortcodeFromUrl,
} from "./extract.js";
import { httpGet, httpGetJson, isStopped } from "./http.js";
import type { CommentData, Json, PostData, ProfileData } from "./types.js";
import { c, parseHumanNumber, toIso, toNumber, unique } from "./util.js";

function classifyPost(node: Json): PostData["type"] {
  const typename = String(node.__typename ?? node.typename ?? "");
  const productType = String(node.product_type ?? "");
  const mediaType = toNumber(node.media_type);

  if (productType === "clips" || node.is_reel === true) return "reel";
  if (mediaType === 8 || typename.includes("Sidecar") || typename.includes("Carousel") || node.carousel_media !== undefined) {
    return "carousel";
  }
  if (mediaType === 2 || typename.includes("Video") || node.is_video === true || node.video_url !== undefined || node.video_versions !== undefined) {
    return "video";
  }
  if (mediaType === 1 || typename.includes("Image") || typename.includes("Photo")) return "photo";
  return "unknown";
}

function captionOf(node: Json): string | null {
  const edges = (node.edge_media_to_caption as Json)?.edges;
  if (Array.isArray(edges) && edges.length > 0) {
    const text = ((edges[0] as Json)?.node as Json)?.text;
    if (typeof text === "string") return text;
  }
  const cap = node.caption;
  if (typeof cap === "string") return cap;
  if (isObject(cap) && typeof cap.text === "string") return cap.text;
  return typeof node.accessibility_caption === "string" ? node.accessibility_caption : null;
}

export function postFromNode(node: Json): PostData | null {
  const shortcode =
    (typeof node.shortcode === "string" ? node.shortcode : null) ??
    (typeof node.code === "string" ? node.code : null);
  if (!shortcode) return null;

  // owner hid the likes. instagram still sends a small fake number
  // so we throw it away instead of using it.
  const countsHidden = node.like_and_view_counts_disabled === true;

  const likes =
    toNumber((node.edge_liked_by as Json)?.count) ??
    toNumber((node.edge_media_preview_like as Json)?.count) ??
    toNumber(node.like_count);
  const comments =
    toNumber((node.edge_media_to_comment as Json)?.count) ??
    toNumber((node.edge_media_preview_comment as Json)?.count) ??
    toNumber((node.edge_media_to_parent_comment as Json)?.count) ??
    toNumber(node.comment_count);
  const views =
    toNumber(node.video_view_count) ??
    toNumber(node.video_play_count) ??
    toNumber(node.play_count) ??
    toNumber(node.view_count);

  const type = classifyPost(node);
  return {
    url: postUrlFromShortcode(shortcode, type === "reel"),
    type,
    publishedAt: toIso(node.taken_at_timestamp ?? node.taken_at ?? node.device_timestamp),
    caption: captionOf(node),
    likes: countsHidden ? null : likes,
    comments,
    views: countsHidden ? null : views,
    shares: toNumber(node.reshare_count),
    saves: toNumber(node.save_count),
    shortcode,
    countsHidden: countsHidden ? true : undefined,
  };
}

export function postsFromEdges(edges: unknown): PostData[] {
  if (!Array.isArray(edges)) return [];
  const out: PostData[] = [];
  for (const edge of edges) {
    const node = isObject(edge) && isObject(edge.node) ? edge.node : edge;
    if (!isObject(node)) continue;
    const post = postFromNode(node);
    if (post) out.push(post);
  }
  return out;
}

function looksLikeMediaNode(n: Json): boolean {
  const code =
    (typeof n.shortcode === "string" ? n.shortcode : null) ??
    (typeof n.code === "string" ? n.code : null);
  if (!code || !/^[A-Za-z0-9_-]{5,}$/.test(code)) return false;

  return [
    "taken_at_timestamp", "taken_at", "__typename", "media_type", "product_type",
    "edge_media_to_comment", "edge_media_preview_like", "like_count", "comment_count",
  ].some((key) => key in n);
}

function looksLikeCommentNode(n: Json): boolean {
  if (typeof n.text !== "string") return false;
  const owner = n.owner ?? n.user;
  return isObject(owner) && typeof owner.username === "string";
}

function commentFromNode(node: Json, postUrl: string): CommentData | null {
  const text =
    (typeof node.text === "string" ? node.text : null) ??
    (typeof node.comment_text === "string" ? node.comment_text : null);
  const owner = (node.owner ?? node.user) as Json | undefined;
  const username =
    (typeof owner?.username === "string" ? owner.username : null) ??
    (typeof node.username === "string" ? node.username : null);
  if (text === null && username === null) return null;

  return {
    postUrl,
    text,
    username,
    timestamp: toIso(node.created_at ?? node.created_at_utc ?? node.timestamp),
    likes:
      toNumber((node.edge_liked_by as Json)?.count) ??
      toNumber(node.comment_like_count) ??
      toNumber(node.like_count),
  };
}

function mergePosts(into: PostData[], incoming: PostData[]): void {
  const seen = new Set(into.map((p) => p.shortcode ?? p.url));
  for (const p of incoming) {
    const key = p.shortcode ?? p.url;
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(p);
  }
}

function fillPost(target: PostData, source: PostData): void {
  target.type = target.type === "unknown" ? source.type : target.type;
  target.publishedAt = target.publishedAt ?? source.publishedAt;
  target.caption = target.caption ?? source.caption;
  target.likes = target.likes ?? source.likes;
  target.comments = target.comments ?? source.comments;
  target.views = target.views ?? source.views;
  target.shares = target.shares ?? source.shares;
  target.saves = target.saves ?? source.saves;
  target.countsHidden = target.countsHidden ?? source.countsHidden;
  target.countsApproximate = target.countsApproximate ?? source.countsApproximate;
}

const TIMELINE_QUERY_HASHES = [
  "e769aa130647d2354c40ea6a439bfc08",
  "58b6785bea111c67129decbe6a448951",
  "8c2a529969ee035a5063f2fc8602a0fd",
];

async function paginateTimeline(
  userId: string,
  firstCursor: string | null,
  already: PostData[],
  profileUrl: string,
): Promise<{ posts: PostData[]; reason: string | null }> {
  const posts = [...already];
  let cursor = firstCursor;
  let reason: string | null = null;
  let hashIndex = 0;

  while (posts.length < MAX_POSTS && cursor && !isStopped()) {
    let advanced = false;

    for (; hashIndex < TIMELINE_QUERY_HASHES.length; hashIndex += 1) {
      const variables = encodeURIComponent(
        JSON.stringify({ id: userId, first: Math.min(50, MAX_POSTS - posts.length), after: cursor }),
      );
      const url =
        `https://www.instagram.com/graphql/query/?query_hash=${TIMELINE_QUERY_HASHES[hashIndex]}` +
        `&variables=${variables}`;

      try {
        const json = await httpGetJson<Json>(url, profileUrl);
        const media = deepFindFirst(json, (n) => Array.isArray(n.edges) && isObject(n.page_info));
        const batch = postsFromEdges(media?.edges);
        if (batch.length === 0) {
          reason = "GraphQL pagination returned no further media.";
          break;
        }
        mergePosts(posts, batch);

        const pageInfo = media?.page_info as Json | undefined;
        cursor =
          pageInfo?.has_next_page === true && typeof pageInfo.end_cursor === "string"
            ? pageInfo.end_cursor
            : null;
        advanced = true;
        break;
      } catch (err) {
        reason = `GraphQL pagination unavailable: ${describeError(err)}`;
        if (isStopped()) break;
      }
    }

    if (!advanced) break;
  }

  return { posts: posts.slice(0, MAX_POSTS), reason };
}

export async function discoverPosts(
  profile: ProfileData,
  seedPosts: PostData[],
  endCursor: string | null,
  profileHtml: string | null,
): Promise<PostData[]> {
  if (profile.isPrivate === true) {
    note("Post discovery", "UNAVAILABLE", "The account is private; its media is not publicly accessible.");
    return [];
  }

  const posts: PostData[] = [];
  mergePosts(posts, seedPosts);
  const notes: string[] = [];

  if (posts.length === 0 && !isStopped()) {
    try {
      const html = profileHtml ?? (await httpGet(profile.profileUrl, { mode: "document" })).body;

      const nodes: Json[] = [];
      for (const blob of collectEmbeddedJson(html)) nodes.push(...deepCollect(blob, looksLikeMediaNode));
      const scraped = nodes.map(postFromNode).filter((p): p is PostData => p !== null);
      mergePosts(posts, scraped);
      if (scraped.length > 0) notes.push("Recovered media nodes from the profile document.");

      if (posts.length === 0) {
        const codes = unique(
          Array.from(html.matchAll(/\/(p|reel|tv)\/([A-Za-z0-9_-]{5,})\//g)).map((m) => `${m[1]}:${m[2]}`),
        );
        const bare: PostData[] = codes.slice(0, MAX_POSTS).map((entry) => {
          const [kind, code] = entry.split(":");
          return {
            url: postUrlFromShortcode(code, kind === "reel"),
            type: kind === "reel" ? "reel" : "unknown",
            publishedAt: null,
            caption: null,
            likes: null,
            comments: null,
            views: null,
            shares: null,
            saves: null,
            shortcode: code,
          };
        });
        mergePosts(posts, bare);
        if (bare.length > 0) notes.push("Only post URLs were recoverable; metrics are null.");
      }
    } catch (err) {
      notes.push(`Profile document scrape failed: ${describeError(err)}`);
    }
  }

  if (posts.length < MAX_POSTS && profile.userId && endCursor && !isStopped()) {
    const { posts: paged, reason } = await paginateTimeline(profile.userId, endCursor, posts, profile.profileUrl);
    posts.length = 0;
    posts.push(...paged);
    if (reason) notes.push(reason);
  } else if (posts.length > 0 && !endCursor) {
    notes.push("No pagination cursor was served, so only the first page of media was reachable.");
  }

  const trimmed = posts.slice(0, MAX_POSTS);
  if (trimmed.length === 0) {
    note("Post discovery", "UNAVAILABLE", notes.join(" ") || "Instagram served no publicly readable media.");
  } else {
    note(
      "Post discovery",
      trimmed.length >= Math.min(MAX_POSTS, 12) ? "OK" : "PARTIAL",
      `Discovered ${trimmed.length} post(s) automatically from the profile URL.` +
        (notes.length ? ` ${notes.join(" ")}` : ""),
    );
  }
  return trimmed;
}

interface PostDetailResult {
  post: PostData;
  comments: CommentData[];
  commentSource: string | null;
}

async function collectPostDetail(post: PostData): Promise<PostDetailResult> {
  const shortcode = post.shortcode ?? shortcodeFromUrl(post.url);
  const merged: PostData = { ...post };
  const comments: CommentData[] = [];
  let commentSource: string | null = null;

  if (!shortcode) return { post: merged, comments, commentSource };

  try {
    const { body: html } = await httpGet(post.url);
    const blobs = collectEmbeddedJson(html);

    const mediaNodes: Json[] = [];
    for (const blob of blobs) {
      mediaNodes.push(
        ...deepCollect(blob, (n) => (n.shortcode === shortcode || n.code === shortcode) && looksLikeMediaNode(n)),
      );
    }
    // the same shortcode shows up in a few nodes.
    // the one with most keys has the real counts, so take that first.
    mediaNodes.sort((x, y) => Object.keys(y).length - Object.keys(x).length);
    for (const node of mediaNodes) {
      const parsed = postFromNode(node);
      if (parsed) fillPost(merged, parsed);
    }

    for (const blob of blobs) {
      for (const node of deepCollect(blob, looksLikeCommentNode)) {
        if (comments.length >= MAX_COMMENTS_PER_POST) break;
        const cm = commentFromNode(node, post.url);
        if (cm) comments.push(cm);
      }
    }
    if (comments.length > 0) commentSource = "post document (embedded JSON)";

    // last resort. this rounds big numbers to "203K" so we mark it as not exact.
    const desc = metaContent(html, "og:description") ?? metaContent(html, "description");
    const m = desc ? /([\d.,]+[KMB]?)\s+likes?,\s*([\d.,]+[KMB]?)\s+comments?/i.exec(desc) : null;
    if (m) {
      if (merged.likes === null) {
        merged.likes = parseHumanNumber(m[1]);
        if (merged.likes !== null && /[KMB]/i.test(m[1])) merged.countsApproximate = true;
      }
      if (merged.comments === null) {
        merged.comments = parseHumanNumber(m[2]);
        if (merged.comments !== null && /[KMB]/i.test(m[2])) merged.countsApproximate = true;
      }
    }

    merged.publishedAt = merged.publishedAt ?? toIso(/"taken_at_timestamp":\s*(\d+)/.exec(html)?.[1]);
    merged.views =
      merged.views ??
      firstNumberMatch(html, [
        /video_view_count\\?":\s*(\d+)/,
        /video_play_count\\?":\s*(\d+)/,
        /play_count\\?":\s*(\d+)/,
      ]);
  } catch {
  }

  const isVideoish = merged.type === "video" || merged.type === "reel" || merged.type === "unknown";
  const stillMissing =
    merged.likes === null ||
    merged.comments === null ||
    merged.caption === null ||
    (merged.views === null && isVideoish);

  if (stillMissing && !isStopped()) {
    try {
      const { body: html } = await httpGet(
        // only the embed page has view counts.
        // it must be asked for as a normal page, an iframe request gets nothing.
        `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
        { mode: "document" },
      );

      merged.likes =
        merged.likes ??
        firstNumberMatch(html, [
          /edge_media_preview_like\\?":\s*\{\\?"count\\?":\s*(\d+)/,
          /edge_liked_by\\?":\s*\{\\?"count\\?":\s*(\d+)/,
          /"like_count":\s*(\d+)/,
        ]);
      merged.comments =
        merged.comments ??
        firstNumberMatch(html, [
          /edge_media_to_comment\\?":\s*\{\\?"count\\?":\s*(\d+)/,
          /edge_media_preview_comment\\?":\s*\{\\?"count\\?":\s*(\d+)/,
          /"comment_count":\s*(\d+)/,
        ]);
      merged.views =
        merged.views ??
        firstNumberMatch(html, [/video_view_count\\?":\s*(\d+)/, /video_play_count\\?":\s*(\d+)/]);

      if (merged.caption === null) {
        const cap = /<div class="Caption"[\s\S]*?<\/div>/i.exec(html)?.[0];
        const text = cap ? decodeEntities(cap.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
        if (text) merged.caption = text;
      }
      merged.publishedAt = merged.publishedAt ?? toIso(/"taken_at_timestamp":\s*(\d+)/.exec(html)?.[1]);

      if (comments.length === 0) {
        for (const blob of collectEmbeddedJson(html)) {
          for (const node of deepCollect(blob, looksLikeCommentNode)) {
            if (comments.length >= MAX_COMMENTS_PER_POST) break;
            const cm = commentFromNode(node, post.url);
            if (cm) comments.push(cm);
          }
        }
        if (comments.length > 0) commentSource = "public embed document";
      }
    } catch {
    }
  }

  if (merged.countsHidden === true) {
    merged.likes = null;
    merged.views = null;
  }
  if (merged.type === "unknown" && merged.views !== null) merged.type = "video";

  return { post: merged, comments: comments.slice(0, MAX_COMMENTS_PER_POST), commentSource };
}

export async function enrichPosts(
  posts: PostData[],
): Promise<{ posts: PostData[]; comments: CommentData[] }> {
  if (posts.length === 0 || !COLLECT_POST_DETAILS) {
    const reason = posts.length === 0 ? "No posts were discovered." : "COLLECT_POST_DETAILS is false.";
    note("Post metrics", "SKIPPED", reason);
    note("Comment collection", "SKIPPED", reason);
    return { posts, comments: [] };
  }

  const allComments: CommentData[] = [];
  const commentSources = new Set<string>();
  const targets = COLLECT_COMMENTS ? Math.min(posts.length, MAX_POSTS_FOR_COMMENTS) : 0;
  let consecutiveFailures = 0;
  let enriched = 0;
  let visited = 0;
  let stopReason: string | null = null;

  process.stdout.write(c.dim(`  Opening up to ${targets} post(s) for metrics and comments...\n`));

  for (let i = 0; i < targets; i += 1) {
    const stop = isStopped();
    if (stop) {
      stopReason = stop.message;
      break;
    }

    const before = { ...posts[i] };
    const result = await collectPostDetail(posts[i]);
    posts[i] = result.post;
    visited += 1;

    const gained =
      (before.likes === null && result.post.likes !== null) ||
      (before.comments === null && result.post.comments !== null) ||
      result.comments.length > 0;

    if (gained) {
      enriched += 1;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
    }

    if (result.comments.length > 0) {
      allComments.push(...result.comments);
      if (result.commentSource) commentSources.add(result.commentSource);
    }

    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      stopReason =
        `Stopped after ${CONSECUTIVE_FAILURE_LIMIT} consecutive posts returned no public metrics or ` +
        `comments (Instagram is gating this data for logged-out clients).`;
      break;
    }

    process.stdout.write(c.dim(`\r  Post ${i + 1}/${targets} - comments collected: ${allComments.length}   `));
  }
  process.stdout.write("\n");

  const withLikes = posts.filter((p) => p.likes !== null).length;
  const withComments = posts.filter((p) => p.comments !== null).length;
  const hidden = posts.filter((p) => p.countsHidden === true).length;
  const approx = posts.filter((p) => p.countsApproximate === true).length;

  if (withLikes === 0 && withComments === 0) {
    note("Post metrics", "UNAVAILABLE", stopReason ?? "Instagram served no like or comment counts.");
  } else {
    note(
      "Post metrics",
      withLikes === posts.length ? "OK" : "PARTIAL",
      `Like counts on ${withLikes}/${posts.length} posts, comment counts on ${withComments}/${posts.length}.` +
        (hidden > 0
          ? ` ${hidden} post(s) have like counts hidden by the account owner and are excluded from the like statistics.`
          : "") +
        (approx > 0 ? ` ${approx} post(s) fell back to rounded link-preview counts.` : "") +
        ` Opened ${visited} post page(s), ${enriched} yielded extra data.` +
        (stopReason ? ` ${stopReason}` : ""),
    );
  }

  if (!COLLECT_COMMENTS) {
    note("Comment collection", "SKIPPED", "COLLECT_COMMENTS is false.");
  } else if (allComments.length === 0) {
    note(
      "Comment collection",
      "UNAVAILABLE",
      "Comment data unavailable - Instagram does not serve comment threads to logged-out clients for this profile." +
        (stopReason ? ` ${stopReason}` : ""),
    );
  } else {
    note(
      "Comment collection",
      "PARTIAL",
      `${allComments.length} comment(s) from ${unique(allComments.map((x) => x.postUrl)).length} post(s) via ` +
        `${Array.from(commentSources).join(", ") || "public documents"}. ` +
        `Public documents expose only a preview of each thread.`,
    );
  }

  return { posts, comments: allComments };
}
